/**
 * Bonus rules engine — amounts, accumulator tiers, deposit stacking, idempotent BONUS ledger posts.
 *
 * Stacking: on a user's first successful deposit, FIRST_DEPOSIT and DEPOSIT configs
 * do not stack; the larger of the two computed amounts is credited once (reference
 * `bonus:deposit-tx:<depositTransactionId>`). Later deposits use DEPOSIT only.
 *
 * Welcome: `rules.fixedAmount` if set, else `percentage` is treated as a flat currency amount.
 *
 * @module lib/bonusEngine
 */
import { toMoney, d } from "./moneyDecimal.js";
import {
  creditWallet,
  restoreWallet,
  walletSnapshot,
} from "./walletBalance.js";
import { cashbackLegOdds, isFullLoss, selectionResultFactor } from "./selectionPayout.js";

/** @param {string} userId */
export function welcomeBonusRef(userId) {
  return `bonus:welcome:${userId}`;
}

/** @param {string} depositTxId */
export function depositBonusRef(depositTxId) {
  return `bonus:deposit-tx:${depositTxId}`;
}

/** @param {string} ticketId */
export function cashbackBonusRef(ticketId) {
  return `bonus:cashback:${ticketId}`;
}

/** Fixture feed statuses that void a ticket's cashback eligibility. */
export const DEFAULT_DISQUALIFY_FIXTURE_STATUSES = ["PST", "CANC", "ABD"];
/** Admin-managed Match statuses that void a ticket's cashback eligibility. */
export const DEFAULT_DISQUALIFY_MATCH_STATUSES = ["SUSPENDED"];

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {import("@prisma/client").BonusType} type
 */
export async function getActiveBonus(db, type) {
  return db.bonus.findFirst({
    where: { type, status: true },
    orderBy: { created_at: "desc" },
  });
}

/**
 * @param {import("@prisma/client").Bonus | null} bonus
 */
export function computeWelcomeFlatAmount(bonus) {
  if (!bonus || bonus.type !== "WELCOME" || !bonus.status) return 0;
  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const fixed = rules.fixedAmount;
  if (typeof fixed === "number" && Number.isFinite(fixed) && fixed > 0) {
    return roundMoney(fixed);
  }
  const pct = Number(bonus.percentage);
  if (Number.isFinite(pct) && pct > 0) return roundMoney(pct);
  return 0;
}

/**
 * @param {import("@prisma/client").Bonus | null} bonus
 * @param {number} depositAmount
 */
export function computeDepositBonusPercentAmount(bonus, depositAmount) {
  if (!bonus || !bonus.status) return 0;
  const min =
    bonus.min_deposit != null ? Number(bonus.min_deposit) : 0;
  if (!Number.isFinite(depositAmount) || depositAmount < min) return 0;
  const p = Number(bonus.percentage);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return roundMoney((depositAmount * p) / 100);
}

/**
 * First deposit: max(FIRST_DEPOSIT, DEPOSIT). Subsequent: DEPOSIT only.
 *
 * @param {import("@prisma/client").Bonus | null} firstDepositBonus
 * @param {import("@prisma/client").Bonus | null} depositBonus
 * @param {number} depositAmount
 * @param {boolean} isFirstDeposit
 */
export function computeStackedDepositBonusAmount(
  firstDepositBonus,
  depositBonus,
  depositAmount,
  isFirstDeposit,
) {
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) return 0;
  if (isFirstDeposit) {
    const a = computeDepositBonusPercentAmount(firstDepositBonus, depositAmount);
    const b = computeDepositBonusPercentAmount(depositBonus, depositAmount);
    return roundMoney(Math.max(a, b));
  }
  return computeDepositBonusPercentAmount(depositBonus, depositAmount);
}

/**
 * Highest matching tier wins.
 *
 * @param {import("@prisma/client").Bonus | null} bonus
 * @param {number} legCount
 */
export function computeAccumulatorPercent(bonus, legCount) {
  if (!bonus || bonus.type !== "ACCUMULATOR" || !bonus.status) return 0;
  const n = Number(legCount);
  if (!Number.isFinite(n) || n < 1) return 0;
  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  let best = 0;
  for (const t of tiers) {
    const minL = Number(t.minLegs);
    const bp = Number(t.bonusPercent);
    if (!Number.isFinite(minL) || !Number.isFinite(bp)) continue;
    if (n >= minL && bp > best) best = bp;
  }
  if (best === 0 && tiers.length === 0) {
    const p = Number(bonus.percentage);
    if (Number.isFinite(p) && p > 0 && n >= 2) return p;
  }
  return best;
}

/**
 * @param {number} stake
 * @param {number} totalOdds
 * @param {number} accumulatorPercent
 */
export function potentialWinWithAccumulator(stake, totalOdds, accumulatorPercent) {
  const s = Number(stake);
  const o = Number(totalOdds);
  const p = Number(accumulatorPercent) || 0;
  if (!Number.isFinite(s) || !Number.isFinite(o)) return 0;
  return toMoney(d(s).mul(d(o)).mul(d(1).add(d(p).div(100))));
}

export function roundMoney(x) {
  return toMoney(x);
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number} legCount
 * @param {number} stake
 * @param {number} totalOdds
 */
export async function resolveAccumulatorForNewTicket(db, legCount, stake, totalOdds) {
  const bonus = await getActiveBonus(db, "ACCUMULATOR");
  const pct = computeAccumulatorPercent(bonus, legCount);
  const potentialWin = potentialWinWithAccumulator(stake, totalOdds, pct);
  return {
    accumulator_bonus_percent: pct,
    potential_win: potentialWin,
  };
}

/**
 * Pick the cashback tier matching `result`.
 *
 * - v2 (`mode !== "halfOpen"`): inclusive on both ends (`r >= min && r <= max`).
 * - v3 (`mode === "halfOpen"`): half-open (`r >= min && r < max`); last tier
 *   with `maxResult == null` is open-ended.
 *
 * @param {number} result
 * @param {Array<{ minResult: number, maxResult: number | null, stakeMultiplier: number }>} tiers
 * @param {"inclusive" | "halfOpen"} [mode="inclusive"]
 */
export function pickCashbackTier(result, tiers, mode = "inclusive") {
  if (!Array.isArray(tiers)) return null;
  const r = Number(result);
  if (!Number.isFinite(r)) return null;
  const halfOpen = mode === "halfOpen";
  for (const t of tiers) {
    if (!t || typeof t !== "object") continue;
    const min = Number(t.minResult);
    const mult = Number(t.stakeMultiplier);
    if (!Number.isFinite(min) || !Number.isFinite(mult)) continue;
    const max = t.maxResult == null ? null : Number(t.maxResult);
    if (max !== null && Number.isNaN(max)) continue;
    const inRange = halfOpen
      ? r >= min && (max === null || r < max)
      : r >= min && (max === null || r <= max);
    if (inRange) {
      return {
        minResult: min,
        maxResult: max,
        stakeMultiplier: mult,
      };
    }
  }
  return null;
}

/**
 * Count LOST legs and sum their odds (v3 divisor).
 *
 * @param {Array<{ result?: string, odds?: number }>} selections
 * @returns {{ count: number, sumOdds: number }}
 */
export function sumLostOdds(selections) {
  let count = 0;
  let sumOdds = 0;
  if (!Array.isArray(selections)) return { count, sumOdds };
  for (const sel of selections) {
    if (!sel) continue;
    if (!isFullLoss(sel)) continue;
    const o = Number(sel.odds);
    if (!Number.isFinite(o) || o <= 0) continue;
    count += 1;
    sumOdds += o;
  }
  return { count, sumOdds };
}

/**
 * Non-VOID selection count (VOID legs are collapsed out of the product).
 *
 * @param {Array<{ result?: string }>} selections
 */
export function cashbackSelectionCount(selections) {
  if (!Array.isArray(selections)) return 0;
  let n = 0;
  for (const sel of selections) {
    if (String(sel?.result ?? "").toUpperCase() === "VOID") continue;
    n += 1;
  }
  return n;
}

/** Default v3 cashback track tables (spec). */
export const DEFAULT_CASHBACK_V3_TRACKS = [
  {
    lostLegs: 1,
    minSelections: 5,
    minStakeOnline: 5,
    minStakeOffline: 10,
    maxCashback: 250000,
    tiers: [
      { minResult: 19, maxResult: 40, stakeMultiplier: 1 },
      { minResult: 40, maxResult: 60, stakeMultiplier: 2 },
      { minResult: 60, maxResult: 90, stakeMultiplier: 4 },
      { minResult: 90, maxResult: 200, stakeMultiplier: 6 },
      { minResult: 200, maxResult: 500, stakeMultiplier: 12 },
      { minResult: 500, maxResult: 1000, stakeMultiplier: 20 },
      { minResult: 1000, maxResult: 2000, stakeMultiplier: 30 },
      { minResult: 2000, maxResult: 3000, stakeMultiplier: 50 },
      { minResult: 3000, maxResult: null, stakeMultiplier: 100 },
    ],
  },
  {
    lostLegs: 2,
    minSelections: 10,
    minStakeOnline: 5,
    minStakeOffline: 5,
    maxCashback: 10000,
    tiers: [
      { minResult: 20, maxResult: 45, stakeMultiplier: 1 },
      { minResult: 45, maxResult: 60, stakeMultiplier: 2.5 },
      { minResult: 60, maxResult: 90, stakeMultiplier: 3.5 },
      { minResult: 90, maxResult: 450, stakeMultiplier: 6 },
      { minResult: 450, maxResult: 1000, stakeMultiplier: 12 },
      { minResult: 1000, maxResult: 1800, stakeMultiplier: 21 },
      { minResult: 1800, maxResult: null, stakeMultiplier: 50 },
    ],
  },
  {
    lostLegs: 3,
    minSelections: 15,
    minStakeOnline: 20,
    minStakeOffline: 20,
    maxCashback: 5000,
    tiers: [
      { minResult: 50, maxResult: 150, stakeMultiplier: 0.5 },
      { minResult: 150, maxResult: 300, stakeMultiplier: 1 },
      { minResult: 300, maxResult: null, stakeMultiplier: 2 },
    ],
  },
];

/** @param {string} ticketId */
export function cashbackPayoutRef(ticketId) {
  return `cashback-payout:${ticketId}`;
}

/**
 * Combined odds for the cashback ratio: product of leg odds with VOID legs
 * collapsed to a 1.0 multiplier (same rule settlement uses for payouts).
 *
 * Recomputed from the final graded legs rather than read off
 * `ticket.total_odds`, because that column is frozen the moment the ticket
 * first turns LOST — at which point legs that are still PENDING are counted
 * at full odds and never revised if they later VOID.
 *
 * @param {Array<{ result?: string, odds?: number }>} selections
 * @returns {number | null}
 */
export function cashbackTotalOddsFromSelections(selections) {
  if (!Array.isArray(selections) || selections.length === 0) return null;
  let product = 1;
  for (const sel of selections) {
    const result = String(sel?.result ?? "").toUpperCase();
    if (result === "VOID") continue;
    if (result === "LOST" && selectionResultFactor(sel) < 1) continue;
    const o = cashbackLegOdds(sel);
    if (o == null) return null;
    product *= o;
  }
  return product;
}

function cashbackFail(reason) {
  return {
    eligible: false,
    amount: 0,
    reason,
    result: null,
    tier: null,
    track: null,
  };
}

function checkDisqualifyStatuses(rules, fixtureStatuses, matchStatuses) {
  const fixtureDq = Array.isArray(rules.disqualifyFixtureStatuses)
    ? rules.disqualifyFixtureStatuses
    : DEFAULT_DISQUALIFY_FIXTURE_STATUSES;
  const matchDq = Array.isArray(rules.disqualifyMatchStatuses)
    ? rules.disqualifyMatchStatuses
    : DEFAULT_DISQUALIFY_MATCH_STATUSES;
  const fixtureDqSet = new Set(fixtureDq.map((s) => String(s).toUpperCase()));
  const matchDqSet = new Set(matchDq.map((s) => String(s).toUpperCase()));
  const hasDqFixture = fixtureStatuses.some(
    (s) => s && fixtureDqSet.has(String(s).toUpperCase()),
  );
  const hasDqMatch = matchStatuses.some(
    (s) => s && matchDqSet.has(String(s).toUpperCase()),
  );
  return hasDqFixture || hasDqMatch;
}

function checkMaxHours(rules, ticket, now) {
  const maxHours = Number(rules.maxHours ?? 0);
  if (!Number.isFinite(maxHours) || maxHours <= 0 || !ticket.created_at) {
    return false;
  }
  const created = new Date(ticket.created_at).getTime();
  const settledAt = new Date(now).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(settledAt)) return false;
  const elapsedHours = (settledAt - created) / MS_PER_HOUR;
  return elapsedHours > maxHours;
}

/**
 * Tiered cashback evaluation v2 (pure, no DB). Ratio uses
 * `totalOdds / largestLostLegOdds`. Kept for DBs that still have v2 rules.
 *
 * @param {Object} p
 * @param {import("@prisma/client").Ticket} p.ticket
 * @param {Array<{ result?: string, odds?: number }>} [p.selections]
 * @param {Array<string>} [p.fixtureStatuses]
 * @param {Array<string>} [p.matchStatuses]
 * @param {import("@prisma/client").Bonus | null} p.bonus
 * @param {Date} [p.now]
 */
export function evaluateCashback({
  ticket,
  selections = [],
  fixtureStatuses = [],
  matchStatuses = [],
  bonus,
  now = new Date(),
}) {
  if (!bonus || bonus.type !== "CASHBACK" || !bonus.status) {
    return cashbackFail("inactive");
  }
  if (!ticket || !ticket.user_id) return cashbackFail("no_user");

  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  if (tiers.length === 0) return cashbackFail("no_tiers");

  const stake = Number(ticket.stake);
  if (!Number.isFinite(stake) || stake <= 0) return cashbackFail("invalid_stake");

  const minStake = Number(rules.minStake ?? 0);
  if (Number.isFinite(minStake) && minStake > 0 && stake < minStake) {
    return cashbackFail("below_min_stake");
  }

  const minSelections = Number(rules.minSelections ?? 0);
  const selectionCount = Array.isArray(selections) ? selections.length : 0;
  if (
    Number.isFinite(minSelections) &&
    minSelections > 0 &&
    !(selectionCount > minSelections)
  ) {
    return cashbackFail("too_few_selections");
  }

  if (checkMaxHours(rules, ticket, now)) {
    return cashbackFail("outside_time_window");
  }

  if (checkDisqualifyStatuses(rules, fixtureStatuses, matchStatuses)) {
    return cashbackFail("disqualified_selection");
  }

  const hasPending = selections.some(
    (s) => String(s?.result ?? "PENDING").toUpperCase() === "PENDING",
  );
  if (hasPending) return cashbackFail("legs_pending");

  let largestLostOdds = 0;
  for (const sel of selections) {
    if (!sel) continue;
    if (!isFullLoss(sel)) continue;
    const o = Number(sel.odds);
    if (Number.isFinite(o) && o > largestLostOdds) largestLostOdds = o;
  }
  if (largestLostOdds <= 0) return cashbackFail("no_lost_leg");

  const fromSelections = cashbackTotalOddsFromSelections(selections);
  const totalOdds =
    fromSelections != null ? fromSelections : Number(ticket.total_odds);
  if (!Number.isFinite(totalOdds) || totalOdds <= 0) {
    return cashbackFail("invalid_total_odds");
  }

  const result = totalOdds / largestLostOdds;
  const minResult = Number(rules.minResult ?? 0);
  if (Number.isFinite(minResult) && minResult > 0 && result < minResult) {
    return cashbackFail("below_min_result");
  }

  const tier = pickCashbackTier(result, tiers, "inclusive");
  if (!tier) return cashbackFail("no_matching_tier");

  const amount = roundMoney(stake * tier.stakeMultiplier);
  if (!(amount > 0)) return cashbackFail("non_positive_amount");

  return {
    eligible: true,
    amount,
    reason: "eligible",
    result,
    tier,
    track: null,
  };
}

/**
 * Multi-track cashback (v3). Ratio = totalOdds / sum(lost leg odds).
 * Exact lost-leg count 1|2|3 selects the track; 4+ pays nothing.
 *
 * @param {Object} p
 * @param {import("@prisma/client").Ticket} p.ticket
 * @param {Array<{ result?: string, odds?: number }>} [p.selections]
 * @param {Array<string>} [p.fixtureStatuses]
 * @param {Array<string>} [p.matchStatuses]
 * @param {import("@prisma/client").Bonus | null} p.bonus
 * @param {boolean} [p.isOffline=false]
 * @param {Date} [p.now]
 */
export function evaluateCashbackV3({
  ticket,
  selections = [],
  fixtureStatuses = [],
  matchStatuses = [],
  bonus,
  isOffline = false,
  now = new Date(),
}) {
  if (!bonus || bonus.type !== "CASHBACK" || !bonus.status) {
    return cashbackFail("inactive");
  }
  if (!ticket) return cashbackFail("no_ticket");

  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const tracks = Array.isArray(rules.tracks) ? rules.tracks : [];
  if (tracks.length === 0) return cashbackFail("no_tracks");

  const stake = Number(ticket.stake);
  if (!Number.isFinite(stake) || stake <= 0) return cashbackFail("invalid_stake");

  if (checkMaxHours(rules, ticket, now)) {
    return cashbackFail("outside_time_window");
  }

  if (checkDisqualifyStatuses(rules, fixtureStatuses, matchStatuses)) {
    return cashbackFail("disqualified_selection");
  }

  const hasPending = selections.some(
    (s) => String(s?.result ?? "PENDING").toUpperCase() === "PENDING",
  );
  if (hasPending) return cashbackFail("legs_pending");

  const { count: lostCount, sumOdds: lostSum } = sumLostOdds(selections);
  if (lostCount <= 0 || lostSum <= 0) return cashbackFail("no_lost_leg");
  if (lostCount < 1 || lostCount > 3) {
    return cashbackFail("unsupported_lost_count");
  }

  const track = tracks.find((t) => Number(t?.lostLegs) === lostCount);
  if (!track) return cashbackFail("no_matching_track");

  const minStake = Number(
    isOffline
      ? (track.minStakeOffline ?? track.minStakeOnline ?? 0)
      : (track.minStakeOnline ?? 0),
  );
  if (Number.isFinite(minStake) && minStake > 0 && stake < minStake) {
    return cashbackFail("below_min_stake");
  }

  const minSelections = Number(track.minSelections ?? 0);
  const selectionCount = cashbackSelectionCount(selections);
  if (
    Number.isFinite(minSelections) &&
    minSelections > 0 &&
    selectionCount < minSelections
  ) {
    return cashbackFail("too_few_selections");
  }

  const fromSelections = cashbackTotalOddsFromSelections(selections);
  const totalOdds =
    fromSelections != null ? fromSelections : Number(ticket.total_odds);
  if (!Number.isFinite(totalOdds) || totalOdds <= 0) {
    return cashbackFail("invalid_total_odds");
  }

  const result = totalOdds / lostSum;
  const tier = pickCashbackTier(result, track.tiers, "halfOpen");
  if (!tier) return cashbackFail("no_matching_tier");

  let amount = roundMoney(stake * tier.stakeMultiplier);
  const maxCashback = Number(track.maxCashback);
  if (Number.isFinite(maxCashback) && maxCashback >= 0 && amount > maxCashback) {
    amount = roundMoney(maxCashback);
  }
  if (!(amount > 0)) return cashbackFail("non_positive_amount");

  return {
    eligible: true,
    amount,
    reason: "eligible",
    result,
    tier,
    track: {
      lostLegs: Number(track.lostLegs),
      minSelections: Number(track.minSelections),
      maxCashback: Number.isFinite(maxCashback) ? maxCashback : null,
    },
  };
}

/**
 * Cashback amount for a LOST ticket.
 * Dispatch: `rules.tracks` → v3; else `rules.tiers` → v2; else legacy flat %.
 *
 * @param {import("@prisma/client").Ticket} ticket
 * @param {import("@prisma/client").Bonus | null} bonus
 * @param {{ selections?: Array, fixtureStatuses?: Array<string>, matchStatuses?: Array<string>, now?: Date, isOffline?: boolean } | null} [context]
 */
export function computeCashbackAmount(ticket, bonus, context = null) {
  if (!bonus || bonus.type !== "CASHBACK" || !bonus.status) return 0;
  if (!ticket) return 0;

  const rules =
    bonus.rules && typeof bonus.rules === "object" ? bonus.rules : {};
  const tracks = Array.isArray(rules.tracks) ? rules.tracks : [];

  if (tracks.length > 0) {
    const ev = evaluateCashbackV3({
      ticket,
      selections: context?.selections ?? [],
      fixtureStatuses: context?.fixtureStatuses ?? [],
      matchStatuses: context?.matchStatuses ?? [],
      bonus,
      isOffline: Boolean(context?.isOffline),
      now: context?.now ?? new Date(),
    });
    return ev.eligible ? ev.amount : 0;
  }

  // v2 / legacy require a player user.
  if (!ticket.user_id) return 0;

  const tiers = Array.isArray(rules.tiers) ? rules.tiers : [];
  if (tiers.length > 0) {
    const ev = evaluateCashback({
      ticket,
      selections: context?.selections ?? [],
      fixtureStatuses: context?.fixtureStatuses ?? [],
      matchStatuses: context?.matchStatuses ?? [],
      bonus,
      now: context?.now ?? new Date(),
    });
    return ev.eligible ? ev.amount : 0;
  }

  // Legacy flat `% of stake` when total odds meet a single minimum.
  const minOdds = Number(rules.minTotalOdds ?? 1);
  const pctStake = Number(rules.percentOfStake ?? bonus.percentage ?? 0);
  const totalOdds = Number(ticket.total_odds);
  const stake = Number(ticket.stake);
  if (!Number.isFinite(totalOdds) || totalOdds < minOdds) return 0;
  if (!Number.isFinite(pctStake) || pctStake <= 0) return 0;
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  return roundMoney((stake * pctStake) / 100);
}

function isUniqueConstraintError(err) {
  return err?.code === "P2002";
}

/**
 * Idempotent credit to main wallet (v1). Bonus wallet can reuse references later.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ walletId: string, amount: number, reference: string }} p
 */
export async function creditBonusIfNew(tx, { walletId, amount, reference }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) {
    return { credited: false, reason: "non_positive" };
  }
  const exists = await tx.transaction.findFirst({
    where: { reference },
    select: { id: true },
  });
  if (exists) return { credited: false, reason: "duplicate" };

  const w = await tx.wallet.findUnique({ where: { id: walletId } });
  if (!w) return { credited: false, reason: "no_wallet" };
  const beforeSnap = walletSnapshot(w);

  // Bonuses are not withdrawable until the player has played through.
  const credited = await creditWallet(tx, w, a, { withdrawable: false });

  try {
    await tx.transaction.create({
      data: {
        wallet_id: walletId,
        type: "BONUS",
        amount: a,
        balance_before: credited.balanceBefore,
        balance_after: credited.balanceAfter,
        reference,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      await restoreWallet(tx, w, beforeSnap);
      return { credited: false, reason: "duplicate_race" };
    }
    throw err;
  }

  return { credited: true, balanceAfter: credited.balanceAfter };
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ walletId: string, depositAmount: number, playerDepositTxId: string, hadFirstDepositAt: Date | null }} p
 */
export async function applyDepositBonusesInTx(tx, p) {
  const { walletId, depositAmount, playerDepositTxId, hadFirstDepositAt } = p;
  const isFirst = !hadFirstDepositAt;
  const [firstB, depB] = await Promise.all([
    getActiveBonus(tx, "FIRST_DEPOSIT"),
    getActiveBonus(tx, "DEPOSIT"),
  ]);
  const amount = computeStackedDepositBonusAmount(
    firstB,
    depB,
    depositAmount,
    isFirst,
  );
  if (amount <= 0) return { credited: false };

  const ref = depositBonusRef(playerDepositTxId);
  return creditBonusIfNew(tx, { walletId, amount, reference: ref });
}

/**
 * Evaluate cashback on a LOST ticket.
 *
 * - Online (user_id set, no cashier print): credit player wallet and persist
 *   `cashback_amount` on the ticket.
 * - Offline (cashier-printed or no user): persist `cashback_amount` only;
 *   cashier redeems later via `cashback-payout:<ticketId>`.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} ticketId
 */
export async function creditCashbackOnLostTicketInTx(tx, ticketId) {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.status !== "LOST") {
    return { credited: false, reason: "not_lost" };
  }

  // Already evaluated (idempotent persist).
  if (Number(ticket.cashback_amount) > 0 || ticket.cashback_paid_at) {
    return {
      credited: false,
      reason: "already_set",
      amount: Number(ticket.cashback_amount) || 0,
    };
  }

  const cashierPrint = await tx.transaction.findFirst({
    where: { type: "BET", reference: `ticket-print:${ticket.id}` },
    select: { id: true },
  });
  const isOffline = Boolean(cashierPrint) || !ticket.user_id;

  const bonus = await getActiveBonus(tx, "CASHBACK");
  if (!bonus) return { credited: false, reason: "not_eligible" };

  const selections = await tx.ticketSelection.findMany({
    where: { ticket_id: ticketId },
  });
  const fixtureIds = [
    ...new Set(selections.map((s) => s.fixture_id).filter(Boolean)),
  ];
  const matchIds = [
    ...new Set(selections.map((s) => s.match_id).filter(Boolean)),
  ];
  const [fixtures, matches] = await Promise.all([
    fixtureIds.length
      ? tx.fixture.findMany({
          where: { id: { in: fixtureIds } },
          select: { status: true },
        })
      : Promise.resolve([]),
    matchIds.length
      ? tx.match.findMany({
          where: { id: { in: matchIds } },
          select: { status: true },
        })
      : Promise.resolve([]),
  ]);

  const amount = computeCashbackAmount(ticket, bonus, {
    selections,
    fixtureStatuses: fixtures.map((f) => f.status).filter(Boolean),
    matchStatuses: matches.map((m) => m.status).filter(Boolean),
    isOffline,
    now: new Date(),
  });
  if (amount <= 0) return { credited: false, reason: "not_eligible" };

  await tx.ticket.update({
    where: { id: ticketId },
    data: { cashback_amount: amount },
  });

  if (isOffline) {
    return { credited: false, stored: true, amount, reason: "offline_pending" };
  }

  const wallet = await tx.wallet.findFirst({
    where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
  });
  if (!wallet) {
    return { credited: false, stored: true, amount, reason: "no_wallet" };
  }

  const credit = await creditBonusIfNew(tx, {
    walletId: wallet.id,
    amount,
    reference: cashbackBonusRef(ticketId),
  });
  return { ...credit, amount, stored: true };
}

/**
 * Public/sanitized shapes for players (no internal fields).
 */
export function sanitizeBonusForPublic(b) {
  if (!b) return null;
  return {
    type: b.type,
    name: b.name,
    percentage: b.percentage,
    min_deposit: b.min_deposit,
    rules: b.rules ?? null,
  };
}
