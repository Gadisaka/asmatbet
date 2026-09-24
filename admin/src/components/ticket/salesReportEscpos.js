/**
 * ESC/POS encoder for cashier dashboard sales report receipts.
 */

import {
  CMD,
  CHARS_80MM,
  CHARS_58MM,
  appendReceiptCutTail,
  concat,
  line,
  center,
  leftRight,
  divider,
  getLogoEscPosPromise,
  getBarcodeEscPosPromise,
} from "./escpos.js";

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00 ETB";
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

function formatCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPrintTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sectionDivider(chars) {
  return divider(chars, "=");
}

export function buildSalesReportBarcodePayload(report) {
  const cashierId = String(report?.cashierId || "cashier").trim();
  const from = String(report?.fromLabel || report?.from || "").trim();
  const to = String(report?.toLabel || report?.to || "").trim();
  const ts = Date.now();
  return `SR-${cashierId}-${from}-${to}-${ts}`.replace(/\s+/g, "");
}

function buildSalesReportEscPosParts(report, opts = {}) {
  const width = opts.width === "58mm" ? "58mm" : "80mm";
  const chars = width === "58mm" ? CHARS_58MM : CHARS_80MM;

  const fromLabel = String(report?.fromLabel || report?.from || "").trim();
  const toLabel = String(report?.toLabel || report?.to || "").trim();
  const branchName = String(report?.branchName || "").trim() || "—";
  const branchLocation = String(report?.branchLocation || "").trim() || "—";

  const parts = [];

  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line(center("SALES REPORT SUMMARY", chars)));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(new Uint8Array(CMD.ALIGN_LEFT));

  parts.push(line(`DATE : ${fromLabel} - ${toLabel}`));
  parts.push(line(`TIME : ${formatPrintTimestamp(report?.printedAt)}`));
  parts.push(line(`${branchName}: ${branchLocation}`));

  parts.push(line(sectionDivider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("BETTING"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(leftRight("Total Bets", formatCount(report?.totalTicketsSold), chars)),
  );
  parts.push(
    line(leftRight("Total Amount", formatMoney(report?.totalSoldPrice), chars)),
  );

  parts.push(line(sectionDivider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("PAYOUT"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(leftRight("Total Payout", formatCount(report?.totalPaidTickets), chars)),
  );
  parts.push(
    line(leftRight("Total Amount", formatMoney(report?.totalPaidAmount), chars)),
  );

  parts.push(line(sectionDivider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("CANCELLED"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(
      leftRight(
        "Total Cancelled",
        formatCount(report?.totalCancelledTickets),
        chars,
      ),
    ),
  );
  parts.push(
    line(
      leftRight(
        "Total Amount",
        formatMoney(report?.totalCancelledAmount),
        chars,
      ),
    ),
  );

  parts.push(line(sectionDivider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("DEPOSIT/WITHDRAWAL"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(
    line(
      leftRight("Deposit Amount", formatMoney(report?.totalDepositAmount), chars),
    ),
  );
  parts.push(
    line(
      leftRight(
        "Withdrawal Amount",
        formatMoney(report?.totalWithdrawAmount),
        chars,
      ),
    ),
  );

  parts.push(line(sectionDivider(chars)));
  parts.push(new Uint8Array(CMD.BOLD_ON));
  parts.push(line("ON HAND"));
  parts.push(new Uint8Array(CMD.BOLD_OFF));
  parts.push(line(leftRight("Amount", formatMoney(report?.grandNet), chars)));

  parts.push(line(sectionDivider(chars)));
  parts.push(new Uint8Array(CMD.ALIGN_CENTER));
  parts.push(line(center("asmatbet.com", chars)));

  return parts;
}

/**
 * @param {Object} report
 * @param {{ width?: "80mm"|"58mm" }} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeSalesReportAsync(report, opts = {}) {
  const { width = "80mm" } = opts;
  const logoBytes = await getLogoEscPosPromise(width);
  const barcodePayload =
    String(report?.barcodePayload || "").trim() ||
    buildSalesReportBarcodePayload(report);

  const parts = [new Uint8Array(CMD.INIT)];

  if (logoBytes.length > 0) {
    parts.push(new Uint8Array(CMD.ALIGN_CENTER));
    parts.push(logoBytes);
  }

  parts.push(...buildSalesReportEscPosParts(report, opts));

  if (barcodePayload) {
    const barcodeBytes = await getBarcodeEscPosPromise(width, barcodePayload);
    if (barcodeBytes.length > 0) {
      parts.push(new Uint8Array(CMD.ALIGN_CENTER));
      parts.push(barcodeBytes);
      parts.push(new Uint8Array(CMD.DEFAULT_LINE_SPACING));
      parts.push(line(""));
    }
  }

  appendReceiptCutTail(parts);
  return concat(...parts);
}
