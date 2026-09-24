import test from "node:test";
import assert from "node:assert/strict";
import {
  isFixtureLegPlaceable,
  isOddspapiMarketOfferable,
  hasProviderOutcomeIds,
} from "../../services/markets/marketSupport.js";
import {
  isFullLoss,
  legPayoutMultiplier,
} from "../../lib/selectionPayout.js";
import { cashbackTotalOddsFromSelections } from "../../lib/bonusEngine.js";

test("isOddspapiMarketOfferable requires priced provider ids", () => {
  assert.equal(
    isOddspapiMarketOfferable({
      name: "Asian Handicap",
      odd_lines: [
        { value: "Home -0.25", odd: 1.9, provider_market_id: 1070, provider_outcome_id: 1070 },
      ],
    }),
    true,
  );
  assert.equal(
    isOddspapiMarketOfferable({
      name: "Asian Handicap",
      odd_lines: [{ value: "Home -0.25", odd: 1.9 }],
    }),
    false,
  );
  assert.equal(
    isOddspapiMarketOfferable({
      name: "Asian Handicap",
      odd_lines: [
        {
          value: "Home -0.25",
          odd: 1.9,
          provider_market_id: null,
          provider_outcome_id: null,
        },
      ],
    }),
    false,
  );
});

test("isFixtureLegPlaceable accepts provider ids even without a grader", () => {
  const withIds = isFixtureLegPlaceable({
    support: { ok: false, reason: "unresolvable_market" },
    providerMarketId: 888,
    providerOutcomeId: 1,
  });
  assert.equal(withIds.ok, true);

  const noIds = isFixtureLegPlaceable({
    support: { ok: false, reason: "unresolvable_market" },
    providerMarketId: null,
    providerOutcomeId: null,
  });
  assert.equal(noIds.ok, false);
  assert.equal(noIds.reason, "unresolvable_market");

  const allowlisted = isFixtureLegPlaceable({
    support: { ok: true },
    providerMarketId: null,
    providerOutcomeId: null,
  });
  assert.equal(allowlisted.ok, true);
  assert.equal(hasProviderOutcomeIds({ provider_market_id: 101, provider_outcome_id: 102 }), true);
  assert.equal(
    hasProviderOutcomeIds({ provider_market_id: null, provider_outcome_id: null }),
    false,
  );
});

test("legPayoutMultiplier pays half-win and half-loss", () => {
  assert.equal(legPayoutMultiplier({ result: "WON", odds: 3, result_factor: 0.5 }), 2);
  assert.equal(legPayoutMultiplier({ result: "LOST", odds: 1.9, result_factor: 0.5 }), 0.5);
  assert.equal(legPayoutMultiplier({ result: "WON", odds: 2, result_factor: 1 }), 2);
  assert.equal(legPayoutMultiplier({ result: "LOST", odds: 2, result_factor: 1 }), 0);
  assert.equal(legPayoutMultiplier({ result: "VOID", odds: 5 }), 1);
  assert.equal(isFullLoss({ result: "LOST", result_factor: 0.5 }), false);
  assert.equal(isFullLoss({ result: "LOST" }), true);
});

test("cashback product skips half-loss and VOID legs", () => {
  assert.equal(
    cashbackTotalOddsFromSelections([
      { result: "WON", odds: 2, result_factor: 1 },
      { result: "LOST", odds: 1.9, result_factor: 0.5 },
      { result: "VOID", odds: 3 },
    ]),
    2,
  );
});
