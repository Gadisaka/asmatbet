/**
 * Behavioural tests for offline cashback redemption
 * (`cashbackPayoutTicket` in ticketsController).
 *
 * Run: node --test backend/tests/cashbackPayoutTicket.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loaderUrl = pathToFileURL(
  path.join(__dirname, "fixtures", "prismaLoader.mjs"),
).href;
register(loaderUrl, import.meta.url);

const stubModule = await import(
  pathToFileURL(path.join(__dirname, "fixtures", "prismaInMemoryStub.js")).href
);
const { resetStore, getStore } = stubModule;

const { cashbackPayoutTicket } = await import(
  "../controllers/ticketsController.js"
);

function seedOfflineCashbackTicket({
  ticketId = "tk-cb-pay",
  cashierId = "cashier-1",
  walletId = "cw-1",
  amount = 20,
  paidAt = null,
} = {}) {
  const store = getStore();
  store.cashier.set(cashierId, {
    id: cashierId,
    wallet_id: walletId,
    branch_name: "B",
    branch_location: "L",
  });
  store.wallet.set(walletId, {
    id: walletId,
    user_id: null,
    wallet_type: "CASHIER",
    balance: 100,
    withdrawable: 0,
  });
  store.ticket.set(ticketId, {
    id: ticketId,
    coupon_number: ticketId,
    receipt_number: `${ticketId}-r`,
    user_id: null,
    cashier_id: cashierId,
    branch_name: "B",
    branch_location: "L",
    stake: 10,
    total_odds: 80,
    potential_win: 0,
    status: "LOST",
    created_at: new Date(),
    cashback_amount: amount,
    cashback_paid_at: paidAt,
    cashback_receipt_number: null,
    payment_receipt_number: null,
    paid_at: null,
    apply_winnings_tax: false,
    winnings_tax_rate: null,
    accumulator_bonus_percent: 0,
    selection_snapshot: [],
  });
  return { ticketId, cashierId, walletId };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("cashbackPayoutTicket credits cashier wallet and marks paid", async () => {
  resetStore();
  const store = getStore();
  const { ticketId, cashierId, walletId } = seedOfflineCashbackTicket();
  const req = {
    params: { id: ticketId },
    body: { cashierId },
    user: { role: "ADMIN", sub: "admin-1" },
    headers: {},
    method: "PATCH",
    originalUrl: `/api/tickets/${ticketId}/cashback-payout`,
  };
  const res = mockRes();

  await cashbackPayoutTicket(req, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body?.cashbackAmount, 20);
  assert.equal(store.wallet.get(walletId).balance, 120);
  const ticket = store.ticket.get(ticketId);
  assert.ok(ticket.cashback_paid_at);
  assert.ok(ticket.cashback_receipt_number);
  assert.equal(ticket.status, "LOST");
  const bonus = [...store.transaction.values()].find(
    (t) => t.reference === `cashback-payout:${ticketId}`,
  );
  assert.ok(bonus);
  assert.equal(bonus.type, "BONUS");
  assert.equal(bonus.amount, 20);
});

test("cashbackPayoutTicket rejects wrong cashier", async () => {
  resetStore();
  const store = getStore();
  const { ticketId } = seedOfflineCashbackTicket();
  store.cashier.set("other-cashier", {
    id: "other-cashier",
    wallet_id: "cw-other",
    branch_name: "B",
    branch_location: "L",
  });

  const req = {
    params: { id: ticketId },
    body: { cashierId: "other-cashier" },
    user: { role: "ADMIN", sub: "admin-1" },
    headers: {},
    method: "PATCH",
    originalUrl: `/api/tickets/${ticketId}/cashback-payout`,
  };
  const res = mockRes();
  await cashbackPayoutTicket(req, res);
  assert.equal(res.statusCode, 403);
});

test("cashbackPayoutTicket blocks double redemption", async () => {
  resetStore();
  const { ticketId, cashierId } = seedOfflineCashbackTicket({
    paidAt: new Date(),
  });
  const req = {
    params: { id: ticketId },
    body: { cashierId },
    user: { role: "ADMIN", sub: "admin-1" },
    headers: {},
    method: "PATCH",
    originalUrl: `/api/tickets/${ticketId}/cashback-payout`,
  };
  const res = mockRes();
  await cashbackPayoutTicket(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body?.code, "already_paid");
});
