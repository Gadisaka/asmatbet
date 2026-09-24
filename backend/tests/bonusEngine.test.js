/**
 * Run: node --test backend/tests/bonusEngine.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAccumulatorPercent,
  computeStackedDepositBonusAmount,
  computeWelcomeFlatAmount,
  computeCashbackAmount,
  evaluateCashback,
  evaluateCashbackV3,
  pickCashbackTier,
  sumLostOdds,
  cashbackTotalOddsFromSelections,
  DEFAULT_CASHBACK_V3_TRACKS,
  potentialWinWithAccumulator,
  roundMoney,
} from "../lib/bonusEngine.js";

const TIERS = [
  { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
  { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
  { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
  { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
  { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
  { minResult: 400, maxResult: null, stakeMultiplier: 10 },
];

function tieredBonus(overrides = {}) {
  return {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: {
      minSelections: 2,
      minStake: 10,
      maxHours: 72,
      minResult: 20,
      tiers: TIERS,
      ...overrides,
    },
  };
}

/**
 * Build N selections, the last one LOST with `lostOdds`, the rest WON.
 * Won-leg odds are chosen so the placement product equals `totalOdds`
 * (cashback reads the product of selection.odds, not ticket.total_odds).
 */
function selections(count, lostOdds, totalOdds = 96) {
  const out = [];
  const wonCount = Math.max(0, count - 1);
  const wonProduct = totalOdds / lostOdds;
  const eachWon = wonCount > 0 ? Math.pow(wonProduct, 1 / wonCount) : 1;
  for (let i = 0; i < count; i++) {
    out.push({
      result: i === count - 1 ? "LOST" : "WON",
      odds: i === count - 1 ? lostOdds : eachWon,
    });
  }
  return out;
}

test("computeWelcomeFlatAmount uses fixedAmount then percentage as flat", () => {
  assert.equal(
    computeWelcomeFlatAmount({
      type: "WELCOME",
      status: true,
      percentage: 0,
      rules: { fixedAmount: 50 },
    }),
    50,
  );
  assert.equal(
    computeWelcomeFlatAmount({
      type: "WELCOME",
      status: true,
      percentage: 25,
      rules: {},
    }),
    25,
  );
});

test("first deposit stacks as max of FIRST_DEPOSIT and DEPOSIT", () => {
  const first = {
    type: "FIRST_DEPOSIT",
    status: true,
    percentage: 50,
    min_deposit: 0,
  };
  const dep = {
    type: "DEPOSIT",
    status: true,
    percentage: 10,
    min_deposit: 0,
  };
  assert.equal(
    computeStackedDepositBonusAmount(first, dep, 100, true),
    50,
  );
  assert.equal(
    computeStackedDepositBonusAmount(first, dep, 100, false),
    10,
  );
});

test("computeAccumulatorPercent picks highest matching tier", () => {
  const bonus = {
    type: "ACCUMULATOR",
    status: true,
    percentage: 0,
    rules: {
      tiers: [
        { minLegs: 3, bonusPercent: 1 },
        { minLegs: 5, bonusPercent: 5 },
      ],
    },
  };
  assert.equal(computeAccumulatorPercent(bonus, 2), 0);
  assert.equal(computeAccumulatorPercent(bonus, 4), 1);
  assert.equal(computeAccumulatorPercent(bonus, 5), 5);
});

test("potentialWinWithAccumulator", () => {
  assert.equal(potentialWinWithAccumulator(10, 2, 10), roundMoney(10 * 2 * 1.1));
});

test("computeCashbackAmount (legacy flat) respects minTotalOdds", () => {
  const bonus = {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: { minTotalOdds: 2, percentOfStake: 5 },
  };
  const ticket = { user_id: "u1", stake: 100, total_odds: 1.5 };
  assert.equal(computeCashbackAmount(ticket, bonus), 0);
  assert.equal(
    computeCashbackAmount({ user_id: "u1", stake: 100, total_odds: 3 }, bonus),
    5,
  );
});

test("pickCashbackTier matches inclusive ranges and open-ended last tier", () => {
  assert.equal(pickCashbackTier(19.99, TIERS), null);
  assert.equal(pickCashbackTier(20, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(44, TIERS).stakeMultiplier, 1);
  assert.equal(pickCashbackTier(45, TIERS).stakeMultiplier, 2);
  assert.equal(pickCashbackTier(99, TIERS).stakeMultiplier, 3);
  assert.equal(pickCashbackTier(199, TIERS).stakeMultiplier, 4);
  assert.equal(pickCashbackTier(399, TIERS).stakeMultiplier, 5);
  assert.equal(pickCashbackTier(400, TIERS).stakeMultiplier, 10);
  assert.equal(pickCashbackTier(99999, TIERS).stakeMultiplier, 10);
});

test("evaluateCashback worked example: 96 odds / 2.3 lost = 41.73 -> stake x1", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 10);
});

test("evaluateCashback uses the largest lost-leg odds (conservative)", () => {
  // Placement 5*4*2*3*2.5 = 300; lost legs 2.0 and 3.0 → 300/3 = 100 → x4
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 22.5, created_at: new Date() },
    selections: [
      { result: "WON", odds: 5 },
      { result: "WON", odds: 4 },
      { result: "LOST", odds: 2.0 },
      { result: "LOST", odds: 3.0 },
      { result: "WON", odds: 2.5 },
    ],
    bonus: tieredBonus(),
    now: new Date(),
  });
  assert.equal(ev.result, 100);
  assert.equal(ev.tier.stakeMultiplier, 4);
  assert.equal(ev.amount, 40);
});

test("evaluateCashback gate: selection count must be greater than minSelections", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(2, 2.3), // minSelections is 2 -> needs > 2
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "too_few_selections");
});

test("evaluateCashback gate: stake below minStake", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 5, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_stake");
});

test("evaluateCashback gate: outside time window", () => {
  const created = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100h ago
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: created },
    selections: selections(3, 2.3),
    bonus: tieredBonus({ maxHours: 72 }),
    now: new Date(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "outside_time_window");
});

test("evaluateCashback gate: any disqualified fixture status voids cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    fixtureStatuses: ["FT", "PST", "FT"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("evaluateCashback gate: any disqualified match status voids cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: selections(3, 2.3),
    matchStatuses: ["FINISHED", "SUSPENDED"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "disqualified_selection");
});

test("evaluateCashback gate: result below minResult", () => {
  // 40 / 2.3 = 17.39 < 20
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 40, created_at: new Date() },
    selections: selections(3, 2.3, 40),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_result");
});

test("cashbackTotalOddsFromSelections multiplies legs and collapses VOID to 1.0", () => {
  assert.equal(
    cashbackTotalOddsFromSelections([
      { result: "WON", odds: 3 },
      { result: "WON", odds: 3 },
      { result: "WON", odds: 3 },
      { result: "LOST", odds: 2.5 },
    ]),
    67.5,
  );
  assert.equal(
    cashbackTotalOddsFromSelections([
      { result: "WON", odds: 3 },
      { result: "VOID", odds: 3 },
      { result: "WON", odds: 3 },
      { result: "LOST", odds: 2.5 },
    ]),
    22.5,
  );
});

test("evaluateCashback recomputes odds from final legs, not the LOST snapshot", () => {
  // ticket.total_odds was frozen at 67.5 when the slip first turned LOST, while
  // the 3.0 leg was still PENDING. It later VOIDed, so the real ratio is
  // 3*1*3*2.5 = 22.5 → 22.5/2.5 = 9, below minResult. Paying off the stale
  // snapshot (67.5/2.5 = 27) would wrongly hand out a x1 tier.
  const ev = evaluateCashback({
    ticket: {
      user_id: "u1",
      stake: 10,
      total_odds: 67.5,
      created_at: new Date(),
    },
    selections: [
      { result: "WON", odds: 3 },
      { result: "VOID", odds: 3 },
      { result: "WON", odds: 3 },
      { result: "LOST", odds: 2.5 },
    ],
    fixtureStatuses: ["FT", "FT", "FT", "FT"],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "below_min_result");
});

test("evaluateCashback gate: any PENDING leg defers cashback", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 96, created_at: new Date() },
    selections: [
      { result: "WON", odds: 1.5 },
      { result: "LOST", odds: 2.3 },
      { result: "PENDING", odds: 1.5 },
    ],
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "legs_pending");
  assert.equal(ev.amount, 0);
});

test("evaluateCashback pays once all pending legs are resolved", () => {
  const ev = evaluateCashback({
    ticket: { user_id: "u1", stake: 10, total_odds: 5.175, created_at: new Date() },
    selections: selections(3, 2.3, 96),
    bonus: tieredBonus(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.reason, "eligible");
  assert.equal(ev.amount, 10);
});

test("computeCashbackAmount uses tiered path when rules.tiers present", () => {
  const amount = computeCashbackAmount(
    { user_id: "u1", stake: 10, total_odds: 5.175, created_at: new Date() },
    tieredBonus(),
    { selections: selections(3, 2.3, 96), now: new Date() },
  );
  assert.equal(amount, 10);
});

function v3Bonus(overrides = {}) {
  return {
    type: "CASHBACK",
    status: true,
    percentage: 0,
    rules: {
      maxHours: 48,
      disqualifyFixtureStatuses: ["PST", "CANC", "ABD"],
      disqualifyMatchStatuses: ["SUSPENDED"],
      tracks: DEFAULT_CASHBACK_V3_TRACKS.map((t) => ({
        ...t,
        tiers: t.tiers.map((tier) => ({ ...tier })),
      })),
      ...overrides,
    },
  };
}

/** N selections with a single LOST leg; product of odds equals totalOdds. */
function selectionsOneLoss(count, lostOdds, totalOdds) {
  return selections(count, lostOdds, totalOdds);
}

/** Build selections with exactly `lostOddsList.length` LOST legs. */
function selectionsMultiLoss(wonCount, lostOddsList, totalOdds) {
  const lostProduct = lostOddsList.reduce((a, b) => a * b, 1);
  const wonProduct = totalOdds / lostProduct;
  const eachWon = wonCount > 0 ? Math.pow(wonProduct, 1 / wonCount) : 1;
  const out = [];
  for (let i = 0; i < wonCount; i++) {
    out.push({ result: "WON", odds: eachWon });
  }
  for (const o of lostOddsList) {
    out.push({ result: "LOST", odds: o });
  }
  return out;
}

test("pickCashbackTier halfOpen matches [min, max) and open-ended last", () => {
  const tiers = [
    { minResult: 19, maxResult: 40, stakeMultiplier: 1 },
    { minResult: 40, maxResult: 60, stakeMultiplier: 2 },
    { minResult: 3000, maxResult: null, stakeMultiplier: 100 },
  ];
  assert.equal(pickCashbackTier(18.99, tiers, "halfOpen"), null);
  assert.equal(pickCashbackTier(19, tiers, "halfOpen").stakeMultiplier, 1);
  assert.equal(pickCashbackTier(39.99, tiers, "halfOpen").stakeMultiplier, 1);
  assert.equal(pickCashbackTier(40, tiers, "halfOpen").stakeMultiplier, 2);
  assert.equal(pickCashbackTier(3000, tiers, "halfOpen").stakeMultiplier, 100);
});

test("sumLostOdds counts and sums LOST legs", () => {
  const { count, sumOdds } = sumLostOdds([
    { result: "WON", odds: 2 },
    { result: "LOST", odds: 1.3 },
    { result: "LOST", odds: 1.3 },
    { result: "VOID", odds: 9 },
  ]);
  assert.equal(count, 2);
  assert.equal(sumOdds, 2.6);
});

test("evaluateCashbackV3 worked example: 46/1.2 ≈ 38.33 → ×1 → 10", () => {
  const ev = evaluateCashbackV3({
    ticket: { user_id: "u1", stake: 10, total_odds: 46, created_at: new Date() },
    selections: selectionsOneLoss(5, 1.2, 46),
    bonus: v3Bonus(),
    isOffline: false,
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.track.lostLegs, 1);
  assert.ok(Math.abs(ev.result - 46 / 1.2) < 1e-9);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 10);
});

test("evaluateCashbackV3 worked example: 110/2.6 ≈ 42.3 → ×1 → 5 (sum divisor)", () => {
  const lost = [1.3, 1.3];
  const ev = evaluateCashbackV3({
    ticket: { user_id: "u1", stake: 5, total_odds: 110, created_at: new Date() },
    selections: selectionsMultiLoss(8, lost, 110),
    bonus: v3Bonus(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.track.lostLegs, 2);
  assert.ok(Math.abs(ev.result - 110 / 2.6) < 1e-9);
  assert.equal(ev.tier.stakeMultiplier, 1);
  assert.equal(ev.amount, 5);
});

test("evaluateCashbackV3 rejects 4+ lost legs", () => {
  const ev = evaluateCashbackV3({
    ticket: { stake: 20, total_odds: 200, created_at: new Date() },
    selections: selectionsMultiLoss(12, [1.2, 1.3, 1.4, 1.5], 200),
    bonus: v3Bonus(),
  });
  assert.equal(ev.eligible, false);
  assert.equal(ev.reason, "unsupported_lost_count");
});

test("evaluateCashbackV3 clamps to maxCashback", () => {
  // Force a huge multiplier path: result >= 3000 on 1-loss track → ×100, capped at 250000.
  const stake = 5000;
  const ev = evaluateCashbackV3({
    ticket: { stake, total_odds: 4000, created_at: new Date() },
    selections: selectionsOneLoss(5, 1.2, 4000),
    bonus: v3Bonus(),
  });
  assert.equal(ev.eligible, true);
  assert.equal(ev.tier.stakeMultiplier, 100);
  assert.equal(ev.amount, 250000);
});

test("evaluateCashbackV3 online vs offline min stake", () => {
  const sels = selectionsOneLoss(5, 1.2, 46);
  const onlineFail = evaluateCashbackV3({
    ticket: { stake: 4, total_odds: 46, created_at: new Date() },
    selections: sels,
    bonus: v3Bonus(),
    isOffline: false,
  });
  assert.equal(onlineFail.reason, "below_min_stake");

  const offlineFail = evaluateCashbackV3({
    ticket: { stake: 9, total_odds: 46, created_at: new Date() },
    selections: sels,
    bonus: v3Bonus(),
    isOffline: true,
  });
  assert.equal(offlineFail.reason, "below_min_stake");

  const offlineOk = evaluateCashbackV3({
    ticket: { stake: 10, total_odds: 46, created_at: new Date() },
    selections: sels,
    bonus: v3Bonus(),
    isOffline: true,
  });
  assert.equal(offlineOk.eligible, true);
});

test("evaluateCashbackV3 minSelections is inclusive (>=)", () => {
  const tooFew = evaluateCashbackV3({
    ticket: { stake: 10, total_odds: 46, created_at: new Date() },
    selections: selectionsOneLoss(4, 1.2, 46),
    bonus: v3Bonus(),
  });
  assert.equal(tooFew.reason, "too_few_selections");

  const ok = evaluateCashbackV3({
    ticket: { stake: 10, total_odds: 46, created_at: new Date() },
    selections: selectionsOneLoss(5, 1.2, 46),
    bonus: v3Bonus(),
  });
  assert.equal(ok.eligible, true);
});

test("computeCashbackAmount dispatches to v3 when rules.tracks present", () => {
  const amount = computeCashbackAmount(
    { stake: 10, total_odds: 46, created_at: new Date() },
    v3Bonus(),
    { selections: selectionsOneLoss(5, 1.2, 46), isOffline: false },
  );
  assert.equal(amount, 10);
});
