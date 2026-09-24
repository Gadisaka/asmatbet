import { test } from "node:test";
import assert from "node:assert/strict";
import ou from "../../services/markets/overUnder.js";
import { ValidationError } from "../../services/markets/errors.js";

const mr = (h, a) => ({
  finality: "FINAL",
  scores: { fullTime: { home: h, away: a }, halfTime: { home: null, away: null } },
  stats: {},
  events: [],
});

test("OVER_UNDER: Over 2.5 on 2-1 (total 3) → WON", () => {
  assert.equal(
    ou.evaluate({ market_params: { side: "OVER", line: 2.5 } }, mr(2, 1)).result,
    "WON",
  );
});

test("OVER_UNDER: Under 2.5 on 2-1 → LOST", () => {
  assert.equal(
    ou.evaluate({ market_params: { side: "UNDER", line: 2.5 } }, mr(2, 1)).result,
    "LOST",
  );
});

test("OVER_UNDER: push on integer line (total 3, line 3) → VOID", () => {
  const r = ou.evaluate({ market_params: { side: "OVER", line: 3 } }, mr(2, 1));
  assert.equal(r.result, "VOID");
  assert.equal(r.reason, "push");
});

test("OVER_UNDER: 0-0 Under 0.5 → WON (regression)", () => {
  assert.equal(
    ou.evaluate({ market_params: { side: "UNDER", line: 0.5 } }, mr(0, 0)).result,
    "WON",
  );
});

test("OVER_UNDER: validate rejects invalid line step", () => {
  assert.throws(() => ou.validate({ side: "OVER", line: 2.3 }), ValidationError);
});

test("OVER_UNDER: validate rejects missing side", () => {
  assert.throws(() => ou.validate({ line: 2.5 }), ValidationError);
});

// Quarter-line tests (split line logic)
test("OVER_UNDER: Under 2.75 on 2-1 (total 3) → LOST (quarter_half_loss)", () => {
  // U2.5 loses (3 > 2.5), U3.0 pushes (3 === 3) → half-loss
  const r = ou.evaluate({ market_params: { side: "UNDER", line: 2.75 } }, mr(2, 1));
  assert.equal(r.result, "LOST");
  assert.equal(r.reason, "quarter_half_loss");
});

test("OVER_UNDER: Over 2.75 on 2-1 (total 3) → WON (quarter_half_win)", () => {
  // O2.5 wins (3 > 2.5), O3.0 pushes (3 === 3) → half-win
  const r = ou.evaluate({ market_params: { side: "OVER", line: 2.75 } }, mr(2, 1));
  assert.equal(r.result, "WON");
  assert.equal(r.reason, "quarter_half_win");
});

test("OVER_UNDER: Under 2.75 on 1-0 (total 1) → WON (quarter_full_win)", () => {
  // U2.5 wins (1 < 2.5), U3.0 wins (1 < 3) → full win
  const r = ou.evaluate({ market_params: { side: "UNDER", line: 2.75 } }, mr(1, 0));
  assert.equal(r.result, "WON");
  assert.equal(r.reason, "quarter_full_win");
});

test("OVER_UNDER: Under 2.75 on 3-1 (total 4) → LOST (quarter_full_loss)", () => {
  // U2.5 loses (4 > 2.5), U3.0 loses (4 > 3) → full loss
  const r = ou.evaluate({ market_params: { side: "UNDER", line: 2.75 } }, mr(3, 1));
  assert.equal(r.result, "LOST");
  assert.equal(r.reason, "quarter_full_loss");
});

test("OVER_UNDER: Over 2.25 on 1-1 (total 2) → LOST (quarter_half_loss)", () => {
  // O2.0 pushes (2 === 2), O2.5 loses (2 < 2.5) → half-loss
  const r = ou.evaluate({ market_params: { side: "OVER", line: 2.25 } }, mr(1, 1));
  assert.equal(r.result, "LOST");
  assert.equal(r.reason, "quarter_half_loss");
});

test("OVER_UNDER: Under 2.25 on 1-1 (total 2) → WON (quarter_half_win)", () => {
  // U2.0 pushes (2 === 2), U2.5 wins (2 < 2.5) → half-win
  const r = ou.evaluate({ market_params: { side: "UNDER", line: 2.25 } }, mr(1, 1));
  assert.equal(r.result, "WON");
  assert.equal(r.reason, "quarter_half_win");
});
