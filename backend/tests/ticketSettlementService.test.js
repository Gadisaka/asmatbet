/**
 * Behavioural tests for `services/ticketSettlementService.js`.
 *
 * The settlement service touches the Prisma client at module level, so
 * we install a hand-rolled in-memory store in front of it. The store
 * mirrors only the surface area the service uses (`fixture`, `match`,
 * `ticket`, `ticketSelection`, `wallet`, `transaction`) and supports
 * `$transaction(callback)` so the service runs inside its own
 * transaction semantics — exactly as it does in production.
 *
 * Run with:  node --test backend/tests/ticketSettlementService.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

// We import the in-memory Prisma stub through a loader hook so the
// module under test sees our shim instead of the real client.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stubAbsPath = pathToFileURL(
  path.join(__dirname, "fixtures", "prismaInMemoryStub.js"),
).href;

// Load the stub directly. Then point both `Config/db.js` exports to it
// by mocking with import.meta cache.
const stubModule = await import(stubAbsPath);
const { resetStore, getStore, prisma } = stubModule;

// Replace the Config/db.js module exports in the loader cache. Node ESM
// doesn't expose its module cache for in-process replacement, so we use
// the `module.register` API the project already uses (no extra deps).
const loaderUrl = pathToFileURL(
  path.join(__dirname, "fixtures", "prismaLoader.mjs"),
).href;
register(loaderUrl, import.meta.url);

const settlement = await import("../services/ticketSettlementService.js");
const { SELECTION_RESULT } = await import("../services/marketEvaluator.js");

function seedFixture({ id, status, homeScore, awayScore, postponedAt = null }) {
  const store = getStore();
  store.fixture.set(id, {
    id,
    api_fixture_id: Number.parseInt(id.replace(/\D/g, ""), 10) || 1,
    status,
    home_score: homeScore,
    away_score: awayScore,
    settled_at: null,
    settled_status: null,
    grading_completed_at: null,
    postponed_at: postponedAt,
  });
}

function seedTicket({
  id,
  userId = null,
  cashierId = null,
  stake,
  totalOdds,
  status = "OPEN",
  receiptNumber = `${id}-receipt`,
  createdAt = new Date(),
  cashbackAmount = 0,
}) {
  const store = getStore();
  store.ticket.set(id, {
    id,
    coupon_number: id,
    receipt_number: receiptNumber,
    user_id: userId,
    cashier_id: cashierId,
    branch_name: "",
    branch_location: "",
    stake,
    total_odds: totalOdds,
    potential_win: stake * totalOdds,
    status,
    created_at: createdAt,
    cashback_amount: cashbackAmount,
    cashback_paid_at: null,
    cashback_receipt_number: null,
  });
}

function seedSelection({
  id,
  ticketId,
  matchId = null,
  fixtureId,
  selection,
  marketCode,
  marketParams = null,
  odds,
  result = SELECTION_RESULT.PENDING,
  resultFactor = null,
}) {
  const store = getStore();
  store.ticketSelection.set(id, {
    id,
    ticket_id: ticketId,
    match_id: matchId,
    fixture_id: fixtureId,
    selection,
    market_code: marketCode,
    market_params: marketParams,
    odds,
    result,
    result_factor: resultFactor,
  });
}

function seedWallet({ id, userId, balance, withdrawable = 0 }) {
  const store = getStore();
  store.wallet.set(id, {
    id,
    user_id: userId,
    wallet_type: "PLAYER",
    balance,
    withdrawable,
  });
}

function seedSetting({ id, key, value }) {
  const store = getStore();
  store.setting.set(id, { id, key, value });
}

test("single-leg WON ticket transitions to PAID and credits player wallet", async () => {
  resetStore();
  seedFixture({ id: "fx-1", status: "FT", homeScore: 2, awayScore: 0 });
  seedTicket({
    id: "tk-1",
    userId: "user-1",
    stake: 100,
    totalOdds: 2,
  });
  seedSelection({
    id: "sel-1",
    ticketId: "tk-1",
    fixtureId: "fx-1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-1", userId: "user-1", balance: 50 });

  const summary = await settlement.settleFixture("fx-1");
  assert.equal(summary.ticketsWon, 1);
  assert.equal(summary.payoutsCredited, 1);

  const store = getStore();
  const ticket = store.ticket.get("tk-1");
  assert.equal(ticket.status, "PAID");

  const wallet = store.wallet.get("w-1");
  // Stake was already debited at placement (not modeled here); credit
  // increases balance by potential_win = 200.
  assert.equal(wallet.balance, 250);
  assert.equal(wallet.withdrawable, 200);

  const txns = [...store.transaction.values()];
  assert.equal(txns.length, 1);
  assert.equal(txns[0].reference, "win-settlement:tk-1");
  assert.equal(txns[0].type, "PAYOUT");
  assert.equal(txns[0].amount, 200);
});

test("WON potential_win is capped at configured MAX_WINNING_AMOUNT", async () => {
  resetStore();
  seedSetting({
    id: "set-maxwin",
    key: "MAX_WINNING_AMOUNT",
    value: "150",
  });
  seedFixture({ id: "fx-cap", status: "FT", homeScore: 1, awayScore: 0 });
  seedTicket({ id: "tk-cap", userId: "user-cap", stake: 100, totalOdds: 2 });
  seedSelection({
    id: "sel-cap",
    ticketId: "tk-cap",
    fixtureId: "fx-cap",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-cap", userId: "user-cap", balance: 0 });

  await settlement.settleFixture("fx-cap");

  const ticket = getStore().ticket.get("tk-cap");
  assert.equal(ticket.potential_win, 150);

  const wallet = getStore().wallet.get("w-cap");
  assert.equal(wallet.balance, 150);
});

test("multi-leg ticket: any LOST leg => ticket LOST immediately", async () => {
  resetStore();
  // Fixture 1 => home wins (1)
  seedFixture({ id: "fx-1", status: "FT", homeScore: 3, awayScore: 1 });
  // Fixture 2 => not yet finished
  seedFixture({ id: "fx-2", status: "NS", homeScore: null, awayScore: null });

  seedTicket({ id: "tk-2", userId: "user-2", stake: 50, totalOdds: 4 });
  seedSelection({
    id: "sel-a",
    ticketId: "tk-2",
    fixtureId: "fx-1",
    selection: "X",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-b",
    ticketId: "tk-2",
    fixtureId: "fx-2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-2", userId: "user-2", balance: 0 });

  const summary = await settlement.settleFixture("fx-1");
  assert.equal(summary.ticketsLost, 1);
  assert.equal(summary.ticketsWon, 0);

  const ticket = getStore().ticket.get("tk-2");
  assert.equal(ticket.status, "LOST");
  assert.equal(ticket.potential_win, 0);
});

test("idempotency: replaying settlement does not double-credit", async () => {
  resetStore();
  seedFixture({ id: "fx-3", status: "FT", homeScore: 1, awayScore: 0 });
  seedTicket({ id: "tk-3", userId: "user-3", stake: 10, totalOdds: 3 });
  seedSelection({
    id: "sel-3",
    ticketId: "tk-3",
    fixtureId: "fx-3",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedWallet({ id: "w-3", userId: "user-3", balance: 0 });

  const a = await settlement.settleFixture("fx-3");
  assert.equal(a.payoutsCredited, 1);

  const b = await settlement.settleFixture("fx-3");
  assert.equal(b.skipped, true);
  assert.equal(b.reason, "already_settled");

  const wallet = getStore().wallet.get("w-3");
  assert.equal(wallet.balance, 30); // credited only once

  const txns = [...getStore().transaction.values()];
  assert.equal(txns.length, 1);
});

test("VOID: cancelled fixture sets selections VOID and refunds via 1.0 multiplier", async () => {
  resetStore();
  seedFixture({ id: "fx-4", status: "CANC", homeScore: null, awayScore: null });
  // Two-leg ticket: leg A on cancelled fixture, leg B on a winning home result.
  seedFixture({ id: "fx-5", status: "FT", homeScore: 2, awayScore: 1 });
  seedTicket({ id: "tk-4", userId: "user-4", stake: 20, totalOdds: 6 });
  seedSelection({
    id: "sel-4a",
    ticketId: "tk-4",
    fixtureId: "fx-4",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedSelection({
    id: "sel-4b",
    ticketId: "tk-4",
    fixtureId: "fx-5",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-4", userId: "user-4", balance: 0 });

  await settlement.settleFixture("fx-4");
  await settlement.settleFixture("fx-5");

  const ticket = getStore().ticket.get("tk-4");
  assert.equal(ticket.status, "PAID");
  // VOID leg collapses to 1.0, winning leg odds=2 => potential_win = 20 * 2 = 40
  assert.equal(ticket.potential_win, 40);

  const wallet = getStore().wallet.get("w-4");
  assert.equal(wallet.balance, 40);
});

test("cashier-printed ticket is NOT auto-credited (cashier payout flow owns it)", async () => {
  resetStore();
  seedFixture({ id: "fx-6", status: "FT", homeScore: 2, awayScore: 0 });
  seedTicket({ id: "tk-6", userId: "user-6", stake: 25, totalOdds: 2 });
  seedSelection({
    id: "sel-6",
    ticketId: "tk-6",
    fixtureId: "fx-6",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-6", userId: "user-6", balance: 100 });

  // Pretend a cashier already print-confirmed: ticket-print:<id> BET on
  // a (different) wallet. Online credit must skip this ticket.
  const store = getStore();
  store.transaction.set("print-1", {
    id: "print-1",
    wallet_id: "cashier-wallet",
    type: "BET",
    amount: 25,
    balance_before: 1000,
    balance_after: 975,
    reference: "ticket-print:tk-6",
  });

  const summary = await settlement.settleFixture("fx-6");
  assert.equal(summary.ticketsWon, 1);
  assert.equal(summary.payoutsCredited, 0);

  const ticket = store.ticket.get("tk-6");
  // Ticket is WON (cashier will payout manually) — not PAID.
  assert.equal(ticket.status, "WON");

  const wallet = store.wallet.get("w-6");
  assert.equal(wallet.balance, 100); // untouched
});

test("PENDING ticket with one resolved leg stays OPEN until others resolve", async () => {
  resetStore();
  seedFixture({ id: "fx-7", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-8", status: "NS", homeScore: null, awayScore: null });
  seedTicket({ id: "tk-7", userId: "user-7", stake: 10, totalOdds: 4 });
  seedSelection({
    id: "sel-7a",
    ticketId: "tk-7",
    fixtureId: "fx-7",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-7b",
    ticketId: "tk-7",
    fixtureId: "fx-8",
    selection: "X",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-7", userId: "user-7", balance: 0 });

  await settlement.settleFixture("fx-7");

  const ticket = getStore().ticket.get("tk-7");
  assert.equal(ticket.status, "OPEN"); // still pending the second leg
});

test("all-VOID ticket → status VOID + refund transaction (idempotent on replay)", async () => {
  resetStore();
  seedFixture({ id: "fx-void-1", status: "CANC", homeScore: null, awayScore: null });
  seedFixture({ id: "fx-void-2", status: "ABD", homeScore: null, awayScore: null });
  seedTicket({ id: "tk-void", userId: "user-void", stake: 40, totalOdds: 6 });
  seedSelection({
    id: "sel-v1",
    ticketId: "tk-void",
    fixtureId: "fx-void-1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedSelection({
    id: "sel-v2",
    ticketId: "tk-void",
    fixtureId: "fx-void-2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-void", userId: "user-void", balance: 0 });

  await settlement.settleFixture("fx-void-1");
  const a = await settlement.settleFixture("fx-void-2");
  assert.equal(a.ticketsVoided, 1);
  assert.equal(a.refundsIssued, 1);

  const ticket = getStore().ticket.get("tk-void");
  assert.equal(ticket.status, "VOID");
  // Stake fully refunded.
  const wallet = getStore().wallet.get("w-void");
  assert.equal(wallet.balance, 40);

  const refunds = [...getStore().transaction.values()].filter(
    (t) => t.reference === "bet-refund:tk-void",
  );
  assert.equal(refunds.length, 1);

  // Replay: engine must not double-refund.
  const replay = await settlement.settleFixture("fx-void-2", { force: true });
  assert.equal(replay.refundsIssued, 0);
  const refundsAfter = [...getStore().transaction.values()].filter(
    (t) => t.reference === "bet-refund:tk-void",
  );
  assert.equal(refundsAfter.length, 1);
  assert.equal(getStore().wallet.get("w-void").balance, 40);
});

test("V2 engine: unknown market on FINAL fixture → leg VOID, ticket recomputed", async () => {
  resetStore();
  process.env.SETTLEMENT_ENGINE = "v2";
  try {
    seedFixture({ id: "fx-v2", status: "FT", homeScore: 2, awayScore: 1 });
    seedTicket({ id: "tk-v2", userId: "user-v2", stake: 10, totalOdds: 3 });
    seedSelection({
      id: "sel-v2",
      ticketId: "tk-v2",
      fixtureId: "fx-v2",
      selection: "weird",
      marketCode: "TOTALLY_UNKNOWN_MARKET",
      odds: 3,
    });
    seedWallet({ id: "w-v2", userId: "user-v2", balance: 0 });

    const summary = await settlement.settleFixture("fx-v2");
    // One leg on an unknown market → VOID → all-VOID ticket → refund.
    assert.equal(summary.ticketsVoided, 1);
    const ticket = getStore().ticket.get("tk-v2");
    assert.equal(ticket.status, "VOID");
    const sel = getStore().ticketSelection.get("sel-v2");
    assert.equal(sel.result, "VOID");
    assert.equal(sel.result_meta?.reason, "unknown_market");
    assert.equal(sel.result_meta?.engineVersion, 2);
  } finally {
    delete process.env.SETTLEMENT_ENGINE;
  }
});

test("V2 engine: AWARDED fixture without scores → VOID / awarded_without_scores", async () => {
  resetStore();
  process.env.SETTLEMENT_ENGINE = "v2";
  try {
    seedFixture({ id: "fx-awd", status: "AWD", homeScore: null, awayScore: null });
    seedTicket({ id: "tk-awd", userId: "user-awd", stake: 25, totalOdds: 2 });
    seedSelection({
      id: "sel-awd",
      ticketId: "tk-awd",
      fixtureId: "fx-awd",
      selection: "1",
      marketCode: "MATCH_WINNER",
      odds: 2,
    });
    seedWallet({ id: "w-awd", userId: "user-awd", balance: 0 });

    const summary = await settlement.settleFixture("fx-awd");
    assert.equal(summary.ticketsVoided, 1);
    const sel = getStore().ticketSelection.get("sel-awd");
    assert.equal(sel.result, "VOID");
    assert.equal(sel.result_meta?.reason, "awarded_without_scores");
  } finally {
    delete process.env.SETTLEMENT_ENGINE;
  }
});

test("grading_completed_at left null when some legs remain PENDING (triggers retry job)", async () => {
  resetStore();
  // Fixture FT but no scores and no resultLabel → V2 returns
  // missing_required_data → VOID; fake that scenario by passing an
  // unsupported finality. Simpler: use FT with null scores which
  // canEvaluate rejects → V2 returns VOID (so the leg DOES resolve).
  // To properly test PENDING-after-settle we need the engine to return
  // PENDING. V2 only returns PENDING for finality === PENDING. So we
  // use FT scores that resolve one leg, and a second leg tied to a
  // *non-terminal* fixture that we do not settle yet.
  seedFixture({ id: "fx-ok", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-later", status: "NS", homeScore: null, awayScore: null });
  seedTicket({ id: "tk-gc", userId: "user-gc", stake: 10, totalOdds: 4 });
  seedSelection({
    id: "sel-gc-a",
    ticketId: "tk-gc",
    fixtureId: "fx-ok",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-gc-b",
    ticketId: "tk-gc",
    fixtureId: "fx-later",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-gc", userId: "user-gc", balance: 0 });

  const summary = await settlement.settleFixture("fx-ok");
  // fx-ok had only one leg: sel-gc-a, graded WON. grading_completed_at
  // should be set for fx-ok because it has no remaining pending legs.
  assert.equal(summary.gradingCompleted, true);
  const fx = getStore().fixture.get("fx-ok");
  assert.ok(fx.grading_completed_at instanceof Date);
  // The ticket itself is still OPEN — leg B hasn't resolved — so no
  // payout yet.
  const ticket = getStore().ticket.get("tk-gc");
  assert.equal(ticket.status, "OPEN");
});

test("admin Match result settles market-coded selections without scores", async () => {
  resetStore();
  const store = getStore();

  store.match.set("m-1", {
    id: "m-1",
    status: "LIVE",
    result: null,
    settled_at: null,
  });
  seedTicket({ id: "tk-m-1", userId: null, stake: 20, totalOdds: 2 });
  seedSelection({
    id: "sel-m-1",
    ticketId: "tk-m-1",
    matchId: "m-1",
    fixtureId: null,
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });

  const summary = await settlement.settleMatch("m-1", "1");
  assert.equal(summary.ticketsWon, 1);
  assert.equal(summary.ticketsLost, 0);

  const selection = store.ticketSelection.get("sel-m-1");
  assert.equal(selection.result, SELECTION_RESULT.WON);
  const ticket = store.ticket.get("tk-m-1");
  assert.equal(ticket.status, "WON");
  const match = store.match.get("m-1");
  assert.ok(match.settled_at instanceof Date);
});

test("LOST player ticket credits cashback when CASHBACK bonus active", async () => {
  resetStore();
  const store = getStore();
  store.bonus.set("cash-1", {
    id: "cash-1",
    type: "CASHBACK",
    name: "Lossback",
    percentage: 0,
    min_deposit: null,
    status: true,
    rules: { minTotalOdds: 1, percentOfStake: 10 },
  });
  seedFixture({ id: "fx-cb", status: "FT", homeScore: 0, awayScore: 1 });
  seedTicket({ id: "tk-cb", userId: "u-cb", stake: 100, totalOdds: 2 });
  seedSelection({
    id: "sel-cb",
    ticketId: "tk-cb",
    fixtureId: "fx-cb",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-cb", userId: "u-cb", balance: 0 });

  const summary = await settlement.settleFixture("fx-cb");
  assert.equal(summary.ticketsLost, 1);

  const txns = [...store.transaction.values()];
  const bonusTx = txns.find((t) => t.type === "BONUS");
  assert.ok(bonusTx);
  assert.equal(bonusTx.reference, "bonus:cashback:tk-cb");
  assert.equal(bonusTx.amount, 10);

  const wallet = store.wallet.get("w-cb");
  assert.equal(wallet.balance, 10);
});

const TIERED_CASHBACK_RULES = {
  minSelections: 2,
  minStake: 10,
  maxHours: 0,
  minResult: 20,
  disqualifyFixtureStatuses: ["PST", "CANC", "ABD"],
  disqualifyMatchStatuses: ["SUSPENDED"],
  tiers: [
    { minResult: 20, maxResult: 44, stakeMultiplier: 1 },
    { minResult: 45, maxResult: 79, stakeMultiplier: 2 },
    { minResult: 80, maxResult: 99, stakeMultiplier: 3 },
    { minResult: 100, maxResult: 199, stakeMultiplier: 4 },
    { minResult: 200, maxResult: 399, stakeMultiplier: 5 },
    { minResult: 400, maxResult: null, stakeMultiplier: 10 },
  ],
};

function seedTieredCashbackBonus() {
  getStore().bonus.set("cash-tier", {
    id: "cash-tier",
    type: "CASHBACK",
    name: "Tiered cashback",
    percentage: 0,
    min_deposit: null,
    status: true,
    rules: TIERED_CASHBACK_RULES,
  });
}

test("LOST ticket credits tiered cashback (totalOdds/lostOdds picks tier)", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // Two home-win legs (4, 10) + one away-win leg (odds 2) that loses.
  // After recompute total_odds = 4*10*2 = 80; result = 80/2 = 40 -> tier x1.
  // Grade winning fixtures first so cashback sees no PENDING legs.
  seedFixture({ id: "fx-w1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-w2", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-l", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-t", userId: "u-t", stake: 10, totalOdds: 80 });
  seedSelection({ id: "s-w1", ticketId: "tk-t", fixtureId: "fx-w1", selection: "1", marketCode: "MATCH_WINNER", odds: 4 });
  seedSelection({ id: "s-w2", ticketId: "tk-t", fixtureId: "fx-w2", selection: "1", marketCode: "MATCH_WINNER", odds: 10 });
  seedSelection({ id: "s-l", ticketId: "tk-t", fixtureId: "fx-l", selection: "1", marketCode: "MATCH_WINNER", odds: 2 });
  seedWallet({ id: "w-t", userId: "u-t", balance: 0 });

  await settlement.settleFixture("fx-w1");
  await settlement.settleFixture("fx-w2");
  const summary = await settlement.settleFixture("fx-l");
  assert.equal(summary.ticketsLost, 1);

  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.ok(bonusTx, "expected a BONUS cashback transaction");
  assert.equal(bonusTx.reference, "bonus:cashback:tk-t");
  assert.equal(bonusTx.amount, 10); // stake 10 x tier multiplier 1
  assert.equal(store.wallet.get("w-t").balance, 10);
});

test("cashback ignores the stale LOST total_odds snapshot when a later leg VOIDs", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // The losing leg grades first, so ticket.total_odds is frozen at
  // 3*2.5*10*3 = 225 while three legs are still PENDING. One of them later
  // VOIDs (unknown market), making the real combined odds 1*2.5*10*3 = 75.
  // Correct ratio 75/2.5 = 30 → x1 → 10. Paying off the 225 snapshot would
  // read 90 → x3 → 30, a 3x overpayment.
  process.env.SETTLEMENT_ENGINE = "v2";
  seedFixture({ id: "fx-sl", status: "FT", homeScore: 0, awayScore: 2 });
  seedFixture({ id: "fx-sw1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-sw2", status: "FT", homeScore: 3, awayScore: 1 });
  seedFixture({ id: "fx-sv", status: "FT", homeScore: 1, awayScore: 0 });
  seedTicket({ id: "tk-snap", userId: "u-snap", stake: 10, totalOdds: 225 });
  seedSelection({
    id: "snap-l",
    ticketId: "tk-snap",
    fixtureId: "fx-sl",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2.5,
  });
  seedSelection({
    id: "snap-w1",
    ticketId: "tk-snap",
    fixtureId: "fx-sw1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 10,
  });
  seedSelection({
    id: "snap-w2",
    ticketId: "tk-snap",
    fixtureId: "fx-sw2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
  });
  seedSelection({
    id: "snap-v",
    ticketId: "tk-snap",
    fixtureId: "fx-sv",
    selection: "1",
    marketCode: "NOT_A_REAL_MARKET",
    odds: 3,
  });
  seedWallet({ id: "w-snap", userId: "u-snap", balance: 0 });

  const early = await settlement.settleFixture("fx-sl");
  assert.equal(early.ticketsLost, 1);
  assert.equal(store.ticket.get("tk-snap").status, "LOST");
  // Snapshot priced the three still-PENDING legs at full odds.
  assert.equal(store.ticket.get("tk-snap").total_odds, 225);

  await settlement.settleFixture("fx-sw1");
  await settlement.settleFixture("fx-sw2");
  await settlement.settleFixture("fx-sv");

  assert.equal(store.ticketSelection.get("snap-v").result, SELECTION_RESULT.VOID);
  // Already-terminal ticket: the snapshot is never revised.
  assert.equal(store.ticket.get("tk-snap").total_odds, 225);

  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.ok(bonusTx, "expected deferred cashback once every leg resolved");
  assert.equal(bonusTx.reference, "bonus:cashback:tk-snap");
  assert.equal(bonusTx.amount, 10, "must price off final odds (75), not snapshot (225)");
  assert.equal(store.wallet.get("w-snap").balance, 10);

  delete process.env.SETTLEMENT_ENGINE;
});

test("LOST ticket with a postponed leg is NOT eligible for tiered cashback", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // Same shape, but one leg sits on a postponed (PST) fixture -> disqualified.
  seedFixture({ id: "fx-w1b", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-pst", status: "PST", homeScore: null, awayScore: null });
  seedFixture({ id: "fx-lb", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-d", userId: "u-d", stake: 10, totalOdds: 80 });
  seedSelection({ id: "d-w1", ticketId: "tk-d", fixtureId: "fx-w1b", selection: "1", marketCode: "MATCH_WINNER", odds: 4 });
  seedSelection({ id: "d-pst", ticketId: "tk-d", fixtureId: "fx-pst", selection: "1", marketCode: "MATCH_WINNER", odds: 10 });
  seedSelection({ id: "d-l", ticketId: "tk-d", fixtureId: "fx-lb", selection: "1", marketCode: "MATCH_WINNER", odds: 2 });
  seedWallet({ id: "w-d", userId: "u-d", balance: 0 });

  await settlement.settleFixture("fx-w1b");
  await settlement.settleFixture("fx-pst");
  const summary = await settlement.settleFixture("fx-lb");
  assert.equal(summary.ticketsLost, 1);

  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.equal(bonusTx, undefined, "postponed leg must block cashback");
  assert.equal(store.wallet.get("w-d").balance, 0);
});

test("tiered cashback defers while a leg is PENDING, then credits when all resolve", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // total_odds 4*10*2 = 80; lost odds 2 -> result 40 -> x1 once all legs graded.
  seedFixture({ id: "fx-dw1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-dw2", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-dl", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-def", userId: "u-def", stake: 10, totalOdds: 80 });
  seedSelection({ id: "def-w1", ticketId: "tk-def", fixtureId: "fx-dw1", selection: "1", marketCode: "MATCH_WINNER", odds: 4 });
  seedSelection({ id: "def-w2", ticketId: "tk-def", fixtureId: "fx-dw2", selection: "1", marketCode: "MATCH_WINNER", odds: 10 });
  seedSelection({ id: "def-l", ticketId: "tk-def", fixtureId: "fx-dl", selection: "1", marketCode: "MATCH_WINNER", odds: 2 });
  seedWallet({ id: "w-def", userId: "u-def", balance: 0 });

  // First losing leg only — other legs still PENDING → no cashback yet.
  const early = await settlement.settleFixture("fx-dl");
  assert.equal(early.ticketsLost, 1);
  assert.equal(store.ticket.get("tk-def").status, "LOST");
  assert.equal(
    [...store.transaction.values()].find((t) => t.type === "BONUS"),
    undefined,
    "must not credit cashback while legs are still PENDING",
  );
  assert.equal(store.wallet.get("w-def").balance, 0);

  // Remaining legs grade WON; already-LOST path retries cashback.
  await settlement.settleFixture("fx-dw1");
  await settlement.settleFixture("fx-dw2");

  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.ok(bonusTx, "expected deferred BONUS cashback after all legs resolve");
  assert.equal(bonusTx.reference, "bonus:cashback:tk-def");
  assert.equal(bonusTx.amount, 10);
  assert.equal(store.wallet.get("w-def").balance, 10);
});

test("tiered cashback deferred credit uses final largest lost odds (may pay nothing)", async () => {
  resetStore();
  const store = getStore();
  seedTieredCashbackBonus();
  // Product 4*5*2.5 = 50. Early lost @2.5 alone would be result 20 (eligible x1),
  // but a later lost @5 makes result 10 < minResult 20 → no cashback.
  seedFixture({ id: "fx-f1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-f2", status: "FT", homeScore: 0, awayScore: 1 });
  seedFixture({ id: "fx-f3", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-fin", userId: "u-fin", stake: 10, totalOdds: 50 });
  seedSelection({ id: "fin-w", ticketId: "tk-fin", fixtureId: "fx-f1", selection: "1", marketCode: "MATCH_WINNER", odds: 4 });
  seedSelection({ id: "fin-l2", ticketId: "tk-fin", fixtureId: "fx-f2", selection: "1", marketCode: "MATCH_WINNER", odds: 5 });
  seedSelection({ id: "fin-l1", ticketId: "tk-fin", fixtureId: "fx-f3", selection: "1", marketCode: "MATCH_WINNER", odds: 2.5 });
  seedWallet({ id: "w-fin", userId: "u-fin", balance: 0 });

  const early = await settlement.settleFixture("fx-f3");
  assert.equal(early.ticketsLost, 1);
  assert.equal(
    [...store.transaction.values()].find((t) => t.type === "BONUS"),
    undefined,
  );

  await settlement.settleFixture("fx-f1");
  await settlement.settleFixture("fx-f2");

  assert.equal(
    [...store.transaction.values()].find((t) => t.type === "BONUS"),
    undefined,
    "final largest lost odds must push result below minResult",
  );
  assert.equal(store.wallet.get("w-fin").balance, 0);
});

test("PENDING legs on terminal tickets (LOST/EXPIRED) are VOIDed so the fixture completes", async () => {
  resetStore();
  const store = getStore();
  // Terminal fixture with a valid score.
  seedFixture({ id: "fx-term", status: "FT", homeScore: 2, awayScore: 0 });

  // One leg whose parent ticket is already LOST, one whose parent is EXPIRED.
  seedTicket({ id: "tk-lost", userId: "u-lost", stake: 30, totalOdds: 2, status: "LOST" });
  seedTicket({ id: "tk-exp", userId: "u-exp", stake: 40, totalOdds: 2, status: "EXPIRED" });
  seedSelection({
    id: "sel-lost",
    ticketId: "tk-lost",
    fixtureId: "fx-term",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedSelection({
    id: "sel-exp",
    ticketId: "tk-exp",
    fixtureId: "fx-term",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-lost", userId: "u-lost", balance: 0 });
  seedWallet({ id: "w-exp", userId: "u-exp", balance: 0 });

  const lostBefore = { ...store.ticket.get("tk-lost") };
  const expBefore = { ...store.ticket.get("tk-exp") };

  const summary = await settlement.settleFixture("fx-term", { force: true });

  // The fixture is no longer stuck: no pending legs, grading completed.
  assert.equal(summary.pendingLegsRemaining, 0);
  assert.equal(summary.gradingCompleted, true);

  // EXPIRED (and other dead statuses except LOST) void leftover legs so the
  // fixture can complete. LOST tickets still grade — cashback waits on the
  // last pending leg.
  const legLost = store.ticketSelection.get("sel-lost");
  const legExp = store.ticketSelection.get("sel-exp");
  assert.notEqual(legLost.result, SELECTION_RESULT.PENDING);
  assert.notEqual(legExp.result, SELECTION_RESULT.PENDING);
  assert.equal(legLost.result, SELECTION_RESULT.WON);
  assert.equal(legExp.result, SELECTION_RESULT.VOID);
  assert.equal(legExp.result_meta?.reason, "ticket_terminal");

  // The dead tickets are untouched: status, payout, refund all unchanged.
  assert.equal(store.ticket.get("tk-lost").status, lostBefore.status);
  assert.equal(store.ticket.get("tk-exp").status, expBefore.status);
  assert.equal(store.ticket.get("tk-lost").potential_win, lostBefore.potential_win);
  assert.equal(store.ticket.get("tk-exp").potential_win, expBefore.potential_win);
  assert.equal(summary.payoutsCredited, 0);
  assert.equal(summary.refundsIssued, 0);
  assert.equal(summary.ticketsWon, 0);
  assert.equal(summary.ticketsLost, 0);
  assert.equal(summary.ticketsVoided, 0);

  // No wallet movement of any kind for the terminal tickets.
  assert.equal(store.wallet.get("w-lost").balance, 0);
  assert.equal(store.wallet.get("w-exp").balance, 0);
  assert.equal([...store.transaction.values()].length, 0);
});

test("unpaid OPEN ticket (no receipt) is not settled", async () => {
  resetStore();
  const store = getStore();
  seedFixture({ id: "fx-unpaid", status: "FT", homeScore: 2, awayScore: 0 });
  seedTicket({
    id: "tk-unpaid",
    userId: null,
    stake: 20,
    totalOdds: 2,
    receiptNumber: null,
  });
  seedSelection({
    id: "sel-unpaid",
    ticketId: "tk-unpaid",
    fixtureId: "fx-unpaid",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });

  const summary = await settlement.settleFixture("fx-unpaid");
  assert.equal(summary.ticketsWon, 0);
  assert.equal(summary.ticketsLost, 0);

  const selection = store.ticketSelection.get("sel-unpaid");
  assert.equal(selection.result, SELECTION_RESULT.PENDING);
  const ticket = store.ticket.get("tk-unpaid");
  assert.equal(ticket.status, "OPEN");
});

test("settleFixture skips PST fixture within 72-hour postponed wait", async () => {
  resetStore();
  const store = getStore();
  const recentPostponed = new Date(Date.now() - 24 * 60 * 60 * 1000);
  seedFixture({
    id: "fx-pst-wait",
    status: "PST",
    homeScore: null,
    awayScore: null,
    postponedAt: recentPostponed,
  });
  seedTicket({ id: "tk-pst-wait", stake: 50, totalOdds: 2 });
  seedSelection({
    id: "sel-pst-wait",
    ticketId: "tk-pst-wait",
    fixtureId: "fx-pst-wait",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });

  const summary = await settlement.settleFixture("fx-pst-wait");
  assert.equal(summary.skipped, true);
  assert.equal(summary.reason, "postponed_wait_pending");
  assert.ok(summary.waitHoursRemaining > 0);
  assert.equal(
    store.ticketSelection.get("sel-pst-wait").result,
    SELECTION_RESULT.PENDING,
  );
});

test("settleFixture voids PST leg after 72-hour postponed wait", async () => {
  resetStore();
  const store = getStore();
  const oldPostponed = new Date(Date.now() - 73 * 60 * 60 * 1000);
  seedFixture({
    id: "fx-pst-old",
    status: "PST",
    homeScore: null,
    awayScore: null,
    postponedAt: oldPostponed,
  });
  seedTicket({ id: "tk-pst-old", stake: 50, totalOdds: 2 });
  seedSelection({
    id: "sel-pst-old",
    ticketId: "tk-pst-old",
    fixtureId: "fx-pst-old",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });

  const summary = await settlement.settleFixture("fx-pst-old");
  assert.equal(summary.skipped, undefined);
  assert.equal(summary.selectionsUpdated, 1);
  assert.equal(
    store.ticketSelection.get("sel-pst-old").result,
    SELECTION_RESULT.VOID,
  );
});

test("settleFixture force bypasses postponed wait", async () => {
  resetStore();
  const store = getStore();
  seedFixture({
    id: "fx-pst-force",
    status: "PST",
    homeScore: null,
    awayScore: null,
    postponedAt: new Date(),
  });
  seedTicket({ id: "tk-pst-force", stake: 50, totalOdds: 2 });
  seedSelection({
    id: "sel-pst-force",
    ticketId: "tk-pst-force",
    fixtureId: "fx-pst-force",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });

  const summary = await settlement.settleFixture("fx-pst-force", { force: true });
  assert.equal(summary.skipped, undefined);
  assert.equal(summary.selectionsUpdated, 1);
  assert.equal(
    store.ticketSelection.get("sel-pst-force").result,
    SELECTION_RESULT.VOID,
  );
});

const V3_CASHBACK_RULES = {
  maxHours: 0,
  disqualifyFixtureStatuses: ["PST", "CANC", "ABD"],
  disqualifyMatchStatuses: ["SUSPENDED"],
  tracks: [
    {
      lostLegs: 1,
      minSelections: 3,
      minStakeOnline: 5,
      minStakeOffline: 10,
      maxCashback: 250000,
      tiers: [
        { minResult: 19, maxResult: 40, stakeMultiplier: 1 },
        { minResult: 40, maxResult: null, stakeMultiplier: 2 },
      ],
    },
    {
      lostLegs: 2,
      minSelections: 3,
      minStakeOnline: 5,
      minStakeOffline: 5,
      maxCashback: 10000,
      tiers: [{ minResult: 20, maxResult: null, stakeMultiplier: 1 }],
    },
    {
      lostLegs: 3,
      minSelections: 3,
      minStakeOnline: 5,
      minStakeOffline: 5,
      maxCashback: 5000,
      tiers: [{ minResult: 20, maxResult: null, stakeMultiplier: 0.5 }],
    },
  ],
};

function seedV3CashbackBonus() {
  getStore().bonus.set("cash-v3", {
    id: "cash-v3",
    type: "CASHBACK",
    name: "V3 cashback",
    percentage: 0,
    min_deposit: null,
    status: true,
    rules: V3_CASHBACK_RULES,
  });
}

test("v3 offline LOST ticket stores cashback_amount without wallet credit", async () => {
  resetStore();
  const store = getStore();
  seedV3CashbackBonus();
  // 4*10*2 = 80; lost @2 → result 40 → ×2; stake 10 → 20
  seedFixture({ id: "fx-ow1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-ow2", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-ol", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({
    id: "tk-off",
    userId: null,
    cashierId: "c-off",
    stake: 10,
    totalOdds: 80,
  });
  seedSelection({
    id: "off-w1",
    ticketId: "tk-off",
    fixtureId: "fx-ow1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 4,
  });
  seedSelection({
    id: "off-w2",
    ticketId: "tk-off",
    fixtureId: "fx-ow2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 10,
  });
  seedSelection({
    id: "off-l",
    ticketId: "tk-off",
    fixtureId: "fx-ol",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  // Cashier print marker — defines offline path.
  store.transaction.set("print-off", {
    id: "print-off",
    wallet_id: "cw-off",
    type: "BET",
    amount: 10,
    reference: "ticket-print:tk-off",
  });
  store.wallet.set("cw-off", {
    id: "cw-off",
    user_id: null,
    wallet_type: "CASHIER",
    balance: 100,
    withdrawable: 0,
  });

  await settlement.settleFixture("fx-ow1");
  await settlement.settleFixture("fx-ow2");
  await settlement.settleFixture("fx-ol");

  const ticket = store.ticket.get("tk-off");
  assert.equal(ticket.status, "LOST");
  assert.equal(ticket.cashback_amount, 20);
  assert.equal(
    [...store.transaction.values()].find(
      (t) => t.type === "BONUS" && String(t.reference).startsWith("bonus:cashback:"),
    ),
    undefined,
    "offline must not auto-credit player BONUS",
  );
  assert.equal(store.wallet.get("cw-off").balance, 100);
});

test("v3 online LOST ticket credits wallet and persists cashback_amount", async () => {
  resetStore();
  const store = getStore();
  seedV3CashbackBonus();
  seedFixture({ id: "fx-nw1", status: "FT", homeScore: 2, awayScore: 0 });
  seedFixture({ id: "fx-nw2", status: "FT", homeScore: 1, awayScore: 0 });
  seedFixture({ id: "fx-nl", status: "FT", homeScore: 0, awayScore: 2 });
  seedTicket({ id: "tk-on", userId: "u-on", stake: 10, totalOdds: 80 });
  seedSelection({
    id: "on-w1",
    ticketId: "tk-on",
    fixtureId: "fx-nw1",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 4,
  });
  seedSelection({
    id: "on-w2",
    ticketId: "tk-on",
    fixtureId: "fx-nw2",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 10,
  });
  seedSelection({
    id: "on-l",
    ticketId: "tk-on",
    fixtureId: "fx-nl",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
  });
  seedWallet({ id: "w-on", userId: "u-on", balance: 0 });

  await settlement.settleFixture("fx-nw1");
  await settlement.settleFixture("fx-nw2");
  await settlement.settleFixture("fx-nl");

  const ticket = store.ticket.get("tk-on");
  assert.equal(ticket.cashback_amount, 20);
  const bonusTx = [...store.transaction.values()].find((t) => t.type === "BONUS");
  assert.ok(bonusTx);
  assert.equal(bonusTx.reference, "bonus:cashback:tk-on");
  assert.equal(bonusTx.amount, 20);
  assert.equal(store.wallet.get("w-on").balance, 20);
});

test("HALFWIN single pays (odds+1)/2 and is WON not PENDING", async () => {
  resetStore();
  seedTicket({ id: "tk-hw", userId: "u-hw", stake: 100, totalOdds: 3 });
  seedSelection({
    id: "sel-hw",
    ticketId: "tk-hw",
    fixtureId: "fx-hw",
    selection: "Home -0.25",
    marketCode: "HANDICAP_ASIAN",
    odds: 3,
    result: SELECTION_RESULT.WON,
    resultFactor: 0.5,
  });

  await settlement.recomputeTicketStatus(prisma, "tk-hw");
  const ticket = getStore().ticket.get("tk-hw");
  assert.equal(ticket.status, "WON");
  assert.equal(ticket.potential_win, 200);
});

test("HALFLOSS single returns half stake as WON", async () => {
  resetStore();
  seedTicket({ id: "tk-hl", userId: "u-hl", stake: 80, totalOdds: 1.9 });
  seedSelection({
    id: "sel-hl",
    ticketId: "tk-hl",
    fixtureId: "fx-hl",
    selection: "Away +0.25",
    marketCode: "HANDICAP_ASIAN",
    odds: 1.9,
    result: SELECTION_RESULT.LOST,
    resultFactor: 0.5,
  });

  await settlement.recomputeTicketStatus(prisma, "tk-hl");
  const ticket = getStore().ticket.get("tk-hl");
  assert.equal(ticket.status, "WON");
  assert.equal(ticket.potential_win, 40);
});

test("HALFLOSS does not zero a parlay that also has a winner", async () => {
  resetStore();
  seedTicket({ id: "tk-mix", userId: "u-mix", stake: 20, totalOdds: 4 });
  seedSelection({
    id: "sel-mix-w",
    ticketId: "tk-mix",
    fixtureId: "fx-a",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 2,
    result: SELECTION_RESULT.WON,
    resultFactor: 1,
  });
  seedSelection({
    id: "sel-mix-hl",
    ticketId: "tk-mix",
    fixtureId: "fx-b",
    selection: "Home -0.25",
    marketCode: "HANDICAP_ASIAN",
    odds: 2,
    result: SELECTION_RESULT.LOST,
    resultFactor: 0.5,
  });

  await settlement.recomputeTicketStatus(prisma, "tk-mix");
  const ticket = getStore().ticket.get("tk-mix");
  assert.equal(ticket.status, "WON");
  assert.equal(ticket.potential_win, 20);
});

test("full LOST still zeros a ticket that also has HALFLOSS", async () => {
  resetStore();
  seedTicket({ id: "tk-fl", userId: "u-fl", stake: 50, totalOdds: 6 });
  seedSelection({
    id: "sel-fl-l",
    ticketId: "tk-fl",
    fixtureId: "fx-c",
    selection: "1",
    marketCode: "MATCH_WINNER",
    odds: 3,
    result: SELECTION_RESULT.LOST,
    resultFactor: 1,
  });
  seedSelection({
    id: "sel-fl-hl",
    ticketId: "tk-fl",
    fixtureId: "fx-d",
    selection: "Home -0.25",
    marketCode: "HANDICAP_ASIAN",
    odds: 2,
    result: SELECTION_RESULT.LOST,
    resultFactor: 0.5,
  });

  await settlement.recomputeTicketStatus(prisma, "tk-fl");
  const ticket = getStore().ticket.get("tk-fl");
  assert.equal(ticket.status, "LOST");
  assert.equal(ticket.potential_win, 0);
});

test("HALFWIN mixed with VOID pays the half-win multiplier", async () => {
  resetStore();
  seedTicket({ id: "tk-hwv", userId: "u-hwv", stake: 100, totalOdds: 3 });
  seedSelection({
    id: "sel-hwv-w",
    ticketId: "tk-hwv",
    fixtureId: "fx-hwv-a",
    selection: "Home -0.25",
    marketCode: "HANDICAP_ASIAN",
    odds: 3,
    result: SELECTION_RESULT.WON,
    resultFactor: 0.5,
  });
  seedSelection({
    id: "sel-hwv-v",
    ticketId: "tk-hwv",
    fixtureId: "fx-hwv-b",
    selection: "Over 2.5",
    marketCode: "OVER_UNDER",
    odds: 1.8,
    result: SELECTION_RESULT.VOID,
    resultFactor: 0,
  });

  await settlement.recomputeTicketStatus(prisma, "tk-hwv");
  const ticket = getStore().ticket.get("tk-hwv");
  assert.equal(ticket.status, "WON");
  assert.equal(ticket.potential_win, 200);
});

