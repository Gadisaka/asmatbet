/**
 * Format numeric coupon/receipt input as #####-##### while typing.
 * Legacy alphanumeric coupons are left unchanged (only spaces stripped).
 */
export function formatCouponNumberInput(raw) {
  const value = String(raw ?? "");
  if (/[a-zA-Z]/.test(value)) {
    return value.replace(/\s+/g, "");
  }
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
