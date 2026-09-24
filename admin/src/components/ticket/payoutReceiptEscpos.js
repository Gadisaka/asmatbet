/**
 * ESC/POS encoder for payment (payout) receipts.
 */

import {
  formatTicketTaxHelper,
  slipGrossTaxNetForTicket,
} from "../../utils/winningsTax.js";
import {
  formatBranchAgentLine,
  formatContactHandle,
} from "./receiptFormat.js";
import {
  CMD,
  CHARS_58MM,
  CHARS_80MM,
  appendReceiptCutTail,
  center,
  concat,
  divider,
  getBarcodeEscPosPromise,
  getLogoEscPosPromise,
  leftRight,
  line,
  wrapText,
} from "./escpos.js";
import { getPayoutBarcodePayload } from "./ticketBarcode.js";

const RECEIPT_WEBSITE = "WWW.ASMATBET.COM";
const RECEIPT_SLOGAN = "BY ETHIOPIANS FOR ETHIOPIANS.";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value) {
  return toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOdds(value) {
  return toNumber(value).toFixed(2);
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${String(date.getFullYear()).slice(-2)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function resolvePayoutSummary(ticket) {
  if (ticket?.payoutSummary) return ticket.payoutSummary;
  const selections = Array.isArray(ticket?.selections) ? ticket.selections : [];
  return {
    totalBets: selections.length,
    wonBets: selections.filter((s) => String(s.result).toUpperCase() === "WON")
      .length,
    refundedBets: selections.filter(
      (s) => String(s.result).toUpperCase() === "VOID",
    ).length,
  };
}

function dottedField(label, chars) {
  const dots = ".".repeat(Math.max(8, chars - label.length - 1));
  return `${label} ${dots}`;
}

function appendPayoutFooterParts(parts, chars, contactEntries = []) {
  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  for (const entry of contactEntries) {
    const name = String(entry?.name || "Contact").trim();
    const handle = formatContactHandle(entry);
    parts.push(line(leftRight(name, handle, chars)));
  }
  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(line(center(RECEIPT_WEBSITE, chars)));
  parts.push(line(divider(chars)));
  parts.push(line(center(RECEIPT_SLOGAN, chars)));
  parts.push(line(center("Terms and Conditions apply.", chars)));
}

function buildPayoutReceiptEscPosParts(ticket, opts) {
  const {
    width = "80mm",
    platformWinningsTax = null,
    contactEntries = [],
    paidByName = "",
  } = opts;

  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;
  const summary = resolvePayoutSummary(ticket);
  const paidAt = ticket?.paidAt || ticket?.paid_at || new Date().toISOString();
  const paymentReceipt =
    ticket?.paymentReceiptNumber || ticket?.payment_receipt_number || "-";
  const paidBy =
    String(paidByName || ticket?.paidByName || ticket?.cashierName || "").trim() ||
    "-";

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket?.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const taxHelper = formatTicketTaxHelper(ticket, platformWinningsTax);
  const taxAmount =
    ticket?.winningsTaxAmount != null && ticket.winningsTaxAmount > 0
      ? ticket.winningsTaxAmount
      : tax;
  const netPay =
    ticket?.netPayout != null && ticket.netPayout > 0 ? ticket.netPayout : net;
  const maxWin = gross || ticket?.potentialWin;

  const parts = [];

  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(center("AsmatBet", chars)));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  parts.push(line(divider(chars)));
  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(center("PAYMENT RECEIPT", chars)));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(new Uint8Array(CMD.ALIGN_LEFT));

  parts.push(line(leftRight("Date & Time", formatDateTime(paidAt), chars)));
  parts.push(
    line(leftRight("Coupon Number", String(ticket?.couponNumber || "-"), chars)),
  );
  parts.push(
    line(leftRight("Receipt Number", String(paymentReceipt), chars)),
  );
  parts.push(
    line(leftRight("Branch / Agent", formatBranchAgentLine(ticket), chars)),
  );

  parts.push(line(divider(chars)));
  parts.push(line(leftRight("TOTAL BETS", String(summary.totalBets), chars)));
  parts.push(line(leftRight("WON BETS", String(summary.wonBets), chars)));
  parts.push(
    line(leftRight("REFUNDED BETS", String(summary.refundedBets), chars)),
  );

  parts.push(line(divider(chars)));
  parts.push(line(leftRight("BETS", String(summary.totalBets), chars)));
  parts.push(line(leftRight("AMOUNT", formatAmount(ticket?.stake), chars)));
  parts.push(line(leftRight("MAX WIN", formatAmount(maxWin), chars)));

  const rightIndent = " ".repeat(Math.floor(chars * 0.35));
  parts.push(line(`${rightIndent}${leftRight("ODD", formatOdds(ticket?.totalOdds), Math.floor(chars * 0.65))}`));
  if (showTax && taxHelper) {
    parts.push(line(taxHelper));
  } else if (showTax) {
    parts.push(
      line(
        `${rightIndent}${leftRight("TAX", formatAmount(taxAmount), Math.floor(chars * 0.65))}`,
      ),
    );
  }

  parts.push(line(divider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(leftRight("NET PAY", formatAmount(netPay), chars)));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(line(divider(chars)));

  parts.push(line(dottedField("Winner Name :", chars)));
  parts.push(line(dottedField("Winner Phone:", chars)));
  parts.push(line(dottedField("Signature   :", chars)));
  parts.push(line(""));
  parts.push(new Uint8Array(CMD.ALIGN_RIGHT));
  parts.push(line(`Paid By : ${paidBy}`));
  parts.push(new Uint8Array(CMD.ALIGN_LEFT));
  parts.push(line(divider(chars)));

  appendPayoutFooterParts(parts, chars, contactEntries);

  return parts;
}

/**
 * @param {Object} ticket
 * @param {Object} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function encodePayoutReceiptAsync(ticket, opts = {}) {
  const { width = "80mm" } = opts;
  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;
  const logoBytes = await getLogoEscPosPromise(width);
  const barcodePayload = getPayoutBarcodePayload(ticket);

  const parts = [new Uint8Array(CMD.INIT)];

  if (logoBytes.length > 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(logoBytes);
  }

  parts.push(...buildPayoutReceiptEscPosParts(ticket, opts));

  if (barcodePayload) {
    const barcodeBytes = await getBarcodeEscPosPromise(width, barcodePayload);
    if (barcodeBytes.length > 0) {
      parts.push(new Uint8Array(CMD.ALIGN_CENTER));
      parts.push(barcodeBytes);
    }
  }

  appendReceiptCutTail(parts);
  return concat(...parts);
}

export { buildPayoutReceiptEscPosParts };
