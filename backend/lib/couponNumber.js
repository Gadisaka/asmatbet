/** New coupons use #####-#####; legacy alphanumeric coupons remain lookup-compatible. */
export const COUPON_NUMBER_PATTERN = /^\d{5}-\d{5}$/;

/** Unique human-facing coupon id — #####-##### (digits). */
export function buildCouponNumber() {
  const a = Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
  const b = Math.floor(Math.random() * 100_000)
    .toString()
    .padStart(5, "0");
  return `${a}-${b}`;
}

/**
 * Clean pasted coupon copy (NBSP/BOM/zero-width trimmed, inner spaces removed).
 * New coupons are numeric #####-#####; legacy alphanumeric still supported.
 *
 * @param {unknown} raw
 * @returns {{ compact: string, compactLower: string }}
 */
export function normalizeCouponLookupInput(raw) {
  let s = String(raw ?? "").normalize("NFKC");
  s = s.replace(/\ufeff/g, "").trim();
  s = s.replace(/[\u00a0\u200b-\u200d\ufeff]/g, "").trim();
  const compact = s.replace(/\s+/g, "");
  const compactLower = compact.toLowerCase();
  return { compact, compactLower };
}

/**
 * Unique DB values we should try against `coupon_number` (handles legacy casing quirks).
 *
 * @param {string} compact
 * @param {string} compactLower
 */
export function couponLookupCandidates(compact, compactLower) {
  /** @type {string[]} */
  const out = [];
  const push = (v) => {
    const t = String(v || "").trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };
  push(compactLower);
  push(compact);
  return out;
}
