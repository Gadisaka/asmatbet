/**
 * Pure helpers for online payment verification (amount parsing, idempotency keys).
 */
import { normalizeEthiopiaPhone } from "./phone.js";

// Re-exported for callers that import the phone normalizer from this module.
export { normalizeEthiopiaPhone };

const ONLINE_PAY_METHODS = new Set(["cbe", "cbebirr", "telebirr"]);

/**
 * `/verify-telebirr` nests fields under `data`; some responses put them on the root.
 * @param {Record<string, unknown>|null|undefined} body
 * @returns {Record<string, unknown>}
 */
export function telebirrReceiptFromVerifyBody(body) {
  if (body?.data && typeof body.data === "object") return body.data;
  return body && typeof body === "object" ? body : {};
}

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseEtbMoneyString(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).replace(/,/g, "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} s
 * @returns {string}
 */
export function sanitizePaySegment(s) {
  return String(s ?? "")
    .trim()
    .replace(/:/g, "-")
    .replace(/\s+/g, "");
}

/**
 * @param {string} method
 * @returns {method is "cbe" | "cbebirr" | "telebirr"}
 */
export function isOnlinePayMethod(method) {
  return ONLINE_PAY_METHODS.has(String(method || "").toLowerCase());
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {{ reference?: string, accountSuffix?: string, receiptNumber?: string, phoneNumber?: string }} parts
 * @returns {string|null}
 */
export function buildOnlinePayLedgerReference(method, parts) {
  const m = String(method).toLowerCase();
  const s = sanitizePaySegment;
  if (m === "telebirr") {
    const ref = s(parts.reference);
    return ref ? `online-pay:telebirr:${ref}` : null;
  }
  if (m === "cbe") {
    const ref = s(parts.reference);
    const suf = s(parts.accountSuffix);
    if (!ref) return null;
    // Legacy receipts are unique on FT ref + account suffix; new mobile
    // receipts are a standalone token with no suffix.
    return suf ? `online-pay:cbe:${ref}:${suf}` : `online-pay:cbe:${ref}`;
  }
  if (m === "cbebirr") {
    const rec = s(parts.receiptNumber);
    const phone = normalizeEthiopiaPhone(parts.phoneNumber);
    return rec && phone ? `online-pay:cbebirr:${rec}:${phone}` : null;
  }
  return null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, unknown>} body
 * @returns {number|null}
 */
export function parseVerifiedAmountEtb(method, body) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return parseEtbMoneyString(body?.amount);
  if (m === "cbebirr") {
    return (
      parseEtbMoneyString(body?.totalPaidAmount) ??
      parseEtbMoneyString(body?.paidAmount)
    );
  }
  if (m === "telebirr") {
    const data = telebirrReceiptFromVerifyBody(body);
    // Settled amount is what the receiver got. totalPaidAmount includes
    // Telebirr service fee + VAT and must not be used for matching/credit.
    return parseEtbMoneyString(data.settledAmount);
  }
  return null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, unknown>} body
 * @returns {boolean}
 */
export function isSuccessfulVerification(method, body) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return body?.success === true;
  if (m === "cbebirr") {
    return String(body?.transactionStatus ?? "").toLowerCase() === "completed";
  }
  if (m === "telebirr") {
    const data = telebirrReceiptFromVerifyBody(body);
    const status = String(data.transactionStatus ?? "")
      .toLowerCase()
      .trim();
    return body?.success === true && status === "completed";
  }
  return false;
}

/**
 * @param {number} declared
 * @param {number} verified
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function amountsMatch(declared, verified, epsilon = 0.01) {
  return Math.abs(declared - verified) <= epsilon;
}
