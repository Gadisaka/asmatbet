import test from "node:test";
import assert from "node:assert/strict";
import {
  andNotOddspapi,
  isOddspapiRow,
  notOddspapiWhere,
  PROVIDER_ODDSPAPI,
} from "../../services/providers/publicScope.js";

test("default SPORTS_PROVIDER hides oddspapi rows", () => {
  const prev = process.env.SPORTS_PROVIDER;
  delete process.env.SPORTS_PROVIDER;
  try {
    assert.deepEqual(notOddspapiWhere(), { provider: { not: PROVIDER_ODDSPAPI } });
    assert.equal(isOddspapiRow({ provider: "oddspapi" }), true);
    assert.equal(isOddspapiRow({ provider: "apifootball" }), false);
    assert.equal(isOddspapiRow({}), false);
  } finally {
    if (prev === undefined) delete process.env.SPORTS_PROVIDER;
    else process.env.SPORTS_PROVIDER = prev;
  }
});

test("SPORTS_PROVIDER=oddspapi serves only oddspapi rows", () => {
  const prev = process.env.SPORTS_PROVIDER;
  process.env.SPORTS_PROVIDER = "oddspapi";
  try {
    assert.deepEqual(notOddspapiWhere(), { provider: PROVIDER_ODDSPAPI });
    assert.equal(isOddspapiRow({ provider: "oddspapi" }), false);
    assert.equal(isOddspapiRow({ provider: "apifootball" }), true);
    assert.equal(isOddspapiRow({}), true);
    const where = andNotOddspapi({ status: "NS" });
    assert.equal(where.AND[1].provider, PROVIDER_ODDSPAPI);
  } finally {
    if (prev === undefined) delete process.env.SPORTS_PROVIDER;
    else process.env.SPORTS_PROVIDER = prev;
  }
});
