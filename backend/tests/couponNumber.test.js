import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCouponNumber,
  COUPON_NUMBER_PATTERN,
  couponLookupCandidates,
  normalizeCouponLookupInput,
} from "../lib/couponNumber.js";

test("buildCouponNumber emits #####-#####", () => {
  for (let i = 0; i < 20; i++) {
    assert.match(buildCouponNumber(), COUPON_NUMBER_PATTERN);
  }
});

test("normalizeCouponLookupInput strips spaces from numeric coupon", () => {
  const { compact, compactLower } = normalizeCouponLookupInput("12 345-67890");
  assert.equal(compact, "12345-67890");
  assert.equal(compactLower, "12345-67890");
});

test("couponLookupCandidates includes lowercase variant for legacy coupons", () => {
  const { compact, compactLower } = normalizeCouponLookupInput("Ab123456");
  const candidates = couponLookupCandidates(compact, compactLower);
  assert.deepEqual(candidates, ["ab123456", "Ab123456"]);
});
