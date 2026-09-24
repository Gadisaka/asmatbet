/**
 * Parse bank / Telebirr SMS bodies for online deposit verification fields.
 *
 * CBE has two receipt styles:
 * - Legacy: `https://apps.cbe.com.et:100/?id=FT…` + 8-digit account suffix
 * - New (2026): `https://mbreciept.cbe.com.et/{token}` (no suffix)
 */

const NEW_CBE_HOST_TOKEN =
  /(?:https?:\/\/)?(?:www\.)?mbreciept\.cbe\.com\.et\/([A-Za-z0-9-]{15,40})\/?/i;
const NEW_CBE_BARE_TOKEN = /^[A-Za-z0-9-]{15,40}$/;
const LEGACY_CBE_COMBINED_ID = /\bid=(FT[A-Za-z0-9]{10})(\d{8})\b/i;
const LEGACY_CBE_FT_REF = /^FT[A-Z0-9]{10}$/i;

/**
 * Extract a new CBE mobile-receipt token from a URL, SMS snippet, or bare token.
 * @param {unknown} input
 * @returns {string|null}
 */
export function extractNewCbeReceiptToken(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  const host = trimmed.match(NEW_CBE_HOST_TOKEN);
  if (host?.[1]) return host[1];
  if (
    !trimmed.toUpperCase().startsWith("FT") &&
    NEW_CBE_BARE_TOKEN.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

/**
 * True when `reference` is a new CBE mobile-receipt token (not FT + suffix).
 * @param {unknown} reference
 * @returns {boolean}
 */
export function isNewCbeReceiptToken(reference) {
  return extractNewCbeReceiptToken(reference) != null;
}

/**
 * @param {unknown} reference
 * @returns {boolean}
 */
export function isLegacyCbeFtReference(reference) {
  return LEGACY_CBE_FT_REF.test(String(reference ?? "").trim());
}

/**
 * Telebirr receipt id from SMS: receipt URL, English/Amharic labels, or a bare 10-char id.
 * @param {string} smsText
 * @returns {string|null}
 */
export function extractTelebirrReferenceFromSms(smsText) {
  const raw = String(smsText ?? "").trim();
  if (!raw) return null;

  const url = raw.match(
    /(?:https?:\/\/)?(?:www\.)?transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i,
  );
  if (url?.[1]) return url[1];

  const labeled = raw.match(
    /(?:transaction|receipt)\s*(?:number|id|no\.?)\s*(?:is|:)?\s*([A-Za-z0-9]{8,})/i,
  );
  if (labeled?.[1]) return labeled[1];

  const amharic = raw.match(
    /የግብይት\s*ቁጥርዎ?\s*(?:[:፡]\s*)?([A-Za-z0-9]{8,})/i,
  );
  if (amharic?.[1]) return amharic[1];

  const compact = raw.replace(/\s+/g, "");
  if (/^[A-Za-z0-9]{10}$/.test(compact)) return compact;
  return null;
}

/**
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {string} smsText
 * @returns {object}
 */
export function extractOnlineDepositFromSms(method, smsText) {
  const raw = String(smsText ?? "").trim();
  if (!raw) {
    return { ok: false, message: "SMS text is empty." };
  }
  const m = String(method).toLowerCase();

  if (m === "cbe") {
    const newToken =
      extractNewCbeReceiptToken(raw) ||
      extractNewCbeReceiptToken(raw.replace(/\s+/g, ""));
    if (newToken) {
      return { ok: true, reference: newToken, accountSuffix: "" };
    }

    const legacy = raw.match(LEGACY_CBE_COMBINED_ID);
    if (legacy) {
      return {
        ok: true,
        reference: legacy[1].toUpperCase(),
        accountSuffix: legacy[2],
      };
    }

    return {
      ok: false,
      message:
        "Could not find a CBE receipt in the SMS. Paste the full message, including the mbreciept.cbe.com.et or apps.cbe.com.et link.",
    };
  }

  if (m === "telebirr") {
    const id = extractTelebirrReferenceFromSms(raw);
    if (!id) {
      return {
        ok: false,
        message:
          "Could not find a Telebirr transaction number in the SMS. Paste the full message, including the transactioninfo.ethiotelecom.et receipt link.",
      };
    }
    return { ok: true, reference: id };
  }

  if (m === "cbebirr") {
    /** e.g. "Txn ID DD3419QEAOK" or receipt link ?TID=…&PH=… */
    let receiptNumber = null;
    const txnMatch = raw.match(/Txn\.?\s*ID\.?\s*[:.]?\s*([A-Za-z0-9]+)/i);
    if (txnMatch) receiptNumber = txnMatch[1];
    if (!receiptNumber) {
      const tidMatch = raw.match(/[?&]TID=([A-Za-z0-9]+)/i);
      if (tidMatch) receiptNumber = tidMatch[1];
    }
    if (!receiptNumber) {
      return {
        ok: false,
        message:
          "Could not find a CBE Birr transaction id (Txn ID or TID=) in the SMS. Paste the full message.",
      };
    }
    let phoneNumber;
    const phMatch = raw.match(/[?&]PH=(\d{10,15})\b/i);
    if (phMatch) phoneNumber = phMatch[1];
    return {
      ok: true,
      receiptNumber,
      ...(phoneNumber ? { phoneNumber } : {}),
    };
  }

  return { ok: false, message: "Unknown payment method." };
}
