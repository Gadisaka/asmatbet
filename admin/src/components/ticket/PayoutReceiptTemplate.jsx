import { forwardRef } from "react";
import {
  formatTicketTaxHelper,
  slipGrossTaxNetForTicket,
} from "../../utils/winningsTax";
import receiptLogo from "../../assets/image.png";
import {
  formatBranchAgentLine,
  formatContactHandle,
} from "./receiptFormat";

const WIDTHS = {
  "80mm": { page: "80mm", body: "76mm", font: "13px" },
  "58mm": { page: "58mm", body: "54mm", font: "12px" },
};

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

function Divider() {
  return (
    <div
      style={{
        borderTop: "1px dashed #000",
        margin: "2mm 0",
      }}
    />
  );
}

function Row({ label, value, bold = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "2mm",
        fontWeight: bold ? 800 : 700,
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: "'Courier New', monospace", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function DottedLine({ label }) {
  return (
    <div style={{ fontWeight: 700, marginBottom: "1.5mm" }}>
      {label}{" "}
      <span style={{ letterSpacing: "0.15em" }}>
        ........................................
      </span>
    </div>
  );
}

const PayoutReceiptTemplate = forwardRef(function PayoutReceiptTemplate(
  {
    ticket,
    width = "80mm",
    barcodeDataUrl = "",
    platformWinningsTax = null,
    contactEntries = [],
    paidByName = "",
  },
  ref,
) {
  if (!ticket) return null;

  const size = WIDTHS[width] || WIDTHS["80mm"];
  const summary = resolvePayoutSummary(ticket);
  const paidAt = ticket.paidAt || ticket.paid_at || new Date().toISOString();
  const paymentReceipt =
    ticket.paymentReceiptNumber || ticket.payment_receipt_number || "-";
  const paidBy =
    String(paidByName || ticket.paidByName || ticket.cashierName || "").trim() ||
    "—";

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const taxHelper = formatTicketTaxHelper(ticket, platformWinningsTax);
  const taxAmount =
    ticket.winningsTaxAmount != null && ticket.winningsTaxAmount > 0
      ? ticket.winningsTaxAmount
      : tax;
  const netPay =
    ticket.netPayout != null && ticket.netPayout > 0 ? ticket.netPayout : net;
  const maxWin = gross || ticket.potentialWin;

  const contacts = Array.isArray(contactEntries) ? contactEntries : [];

  return (
    <div
      ref={ref}
      data-ticket-width={width}
      className="thermal-receipt"
      style={{
        width: size.body,
        maxWidth: size.body,
        margin: "0 auto",
        padding: "4mm 2mm",
        background: "#ffffff",
        color: "#000000",
        fontFamily:
          "'Courier New', 'DejaVu Sans Mono', 'Lucida Console', monospace",
        fontSize: size.font,
        fontWeight: 700,
        lineHeight: 1.35,
        WebkitFontSmoothing: "grayscale",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "2mm" }}>
        <img
          src={receiptLogo}
          alt=""
          style={{
            width: "100%",
            maxWidth: "100%",
            height: "auto",
            display: "block",
            margin: "0 auto",
          }}
        />
        <div style={{ fontWeight: 800, marginTop: "1mm" }}>AsmatBet</div>
      </div>

      <Divider />

      <div style={{ textAlign: "center", fontWeight: 800, marginBottom: "2mm" }}>
        PAYMENT RECEIPT
      </div>

      <Row label="Date & Time" value={formatDateTime(paidAt)} />
      <Row label="Coupon Number" value={ticket.couponNumber || "-"} />
      <Row label="Receipt Number" value={paymentReceipt} />
      <Row label="Branch / Agent" value={formatBranchAgentLine(ticket)} />

      <Divider />

      <Row label="TOTAL BETS" value={String(summary.totalBets)} />
      <Row label="WON BETS" value={String(summary.wonBets)} />
      <Row label="REFUNDED BETS" value={String(summary.refundedBets)} />

      <Divider />

      <Row label="BETS" value={String(summary.totalBets)} />
      <Row label="AMOUNT" value={formatAmount(ticket.stake)} />
      <Row label="MAX WIN" value={formatAmount(maxWin)} />

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "1mm",
        }}
      >
        <div style={{ minWidth: "55%" }}>
          <Row label="ODD" value={formatOdds(ticket.totalOdds)} />
          {showTax && taxHelper ? (
            <div style={{ fontWeight: 700, margin: "1mm 0" }}>{taxHelper}</div>
          ) : showTax ? (
            <Row label="TAX" value={formatAmount(taxAmount)} />
          ) : null}
        </div>
      </div>

      <Divider />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 800,
          fontSize: "14px",
          margin: "1mm 0",
        }}
      >
        <span>NET PAY</span>
        <span>{formatAmount(netPay)}</span>
      </div>

      <Divider />

      <DottedLine label="Winner Name :" />
      <DottedLine label="Winner Phone:" />
      <DottedLine label="Signature   :" />

      <div
        style={{
          textAlign: "right",
          marginTop: "2mm",
          marginBottom: "2mm",
          fontWeight: 700,
        }}
      >
        Paid By : {paidBy}
      </div>

      <Divider />

      {contacts.map((entry, index) => (
        <Row
          key={`${entry?.name || "contact"}-${index}`}
          label={String(entry?.name || "").trim() || "Contact"}
          value={formatContactHandle(entry)}
        />
      ))}

      <div
        style={{
          textAlign: "center",
          fontWeight: 800,
          marginTop: "2mm",
          marginBottom: "2mm",
        }}
      >
        {RECEIPT_WEBSITE}
      </div>

      <Divider />

      <div style={{ textAlign: "center", fontWeight: 700, marginBottom: "2mm" }}>
        {RECEIPT_SLOGAN}
      </div>

      {barcodeDataUrl ? (
        <div style={{ textAlign: "center", margin: "2mm 0" }}>
          <img
            src={barcodeDataUrl}
            alt=""
            style={{
              width: "100%",
              maxWidth: "100%",
              height: "auto",
              display: "block",
              margin: "0 auto",
            }}
          />
        </div>
      ) : null}

      <div
        style={{
          textAlign: "center",
          fontSize: "10px",
          fontWeight: 700,
          marginTop: "1mm",
        }}
      >
        Terms and Conditions apply.
      </div>
    </div>
  );
});

export default PayoutReceiptTemplate;
