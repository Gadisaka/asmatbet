import { forwardRef } from "react";
import {
  formatTicketTaxHelper,
  isWonTicketStatus,
  slipGrossTaxNetForTicket,
} from "../../utils/winningsTax";
import receiptLogo from "../../assets/image.png";
import {
  formatCashierReceiptLine,
  formatSelectionLabelForPrint,
  sortSelectionsByOdds,
} from "./receiptFormat";
import { TICKET_FOOTER_LINES } from "./ticketFooter";

/**
 * Thermal POS receipt for cashier tickets.
 *
 * Designed to be embedded off-screen (.thermal-print-area) and revealed only by
 * the global print stylesheet (admin/src/index.css). Also captured directly by
 * html2pdf.js for the PDF fallback path.
 *
 * Renders as a vertically-flowing 80mm (or 58mm) monospace block. No frames,
 * no shadows — anything fancier degrades on real ESC/POS printers.
 */

const WIDTHS = {
  "80mm": { page: "80mm", body: "76mm", font: "13px" },
  "58mm": { page: "58mm", body: "54mm", font: "12px" },
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`;
}

function formatOdds(value) {
  return toNumber(value).toFixed(2);
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatKickoff(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLeagueLine(country, leagueName) {
  const c = String(country || "").trim();
  const l = String(leagueName || "").trim();
  if (c && l) return `${c} - ${l}`;
  return l || c || "";
}

function buildSelectionLines(ticket) {
  const selections = sortSelectionsByOdds(
    Array.isArray(ticket?.selections) ? ticket.selections : [],
  );
  return selections.map((selection, index) => {
    const home = selection?.match?.homeTeam || "";
    const away = selection?.match?.awayTeam || "";
    const matchName = away ? `${home} vs ${away}` : home || "Match";
    return {
      id: selection.id || `sel-${index}`,
      kickoff: formatKickoff(selection?.match?.startTime),
      leagueLine: formatLeagueLine(
        selection?.match?.country,
        selection?.match?.leagueName,
      ),
      matchName,
      pick: formatSelectionLabelForPrint(
        selection?.selection || selection?.pick || "-",
      ),
      market: selection?.marketLabel || "",
      odds: formatOdds(selection?.odds),
    };
  });
}

const TicketTemplate = forwardRef(function TicketTemplate(
  { ticket, width = "80mm", barcodeDataUrl = "", platformWinningsTax = null },
  ref,
) {
  if (!ticket) return null;

  const size = WIDTHS[width] || WIDTHS["80mm"];
  const lines = buildSelectionLines(ticket);
  const printedAt = formatDate(ticket?.printedAt || ticket?.createdAt);

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket.potentialWin,
    ticket,
  );
  const showTax = tax != null && tax > 0;
  const won = isWonTicketStatus(ticket.status);
  const taxHelper = formatTicketTaxHelper(ticket, platformWinningsTax);

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
      </div>

      <Divider />

      <ReceiptCouponRow
        receipt={ticket.receiptNumber || "-"}
        coupon={ticket.couponNumber || "-"}
      />
      <BranchRow value={formatCashierReceiptLine(ticket)} />
      <Row label="Date" value={printedAt} />

      <Divider />

      {lines.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "4mm 0",
            fontWeight: 700,
            color: "#000000",
          }}
        >
          (no selections)
        </div>
      ) : (
        lines.map((line, idx) => (
          <div key={line.id} style={{ color: "#000000" }}>
            <div style={{ marginBottom: "1.5mm" }}>
              {line.leagueLine ? (
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#000000",
                  }}
                >
                  {line.leagueLine}
                </div>
              ) : null}
              <div style={{ fontWeight: 800 }}>
                {idx + 1}. {line.matchName}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "2mm",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    wordBreak: "break-word",
                    fontWeight: 700,
                    color: "#000000",
                  }}
                >
                  {line.market || "-"}
                </span>
                <span style={{ fontWeight: 800, color: "#000000" }}>
                  {line.pick}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "2mm",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#000000",
                  }}
                >
                  {line.kickoff || "-"}
                </span>
                <span style={{ fontWeight: 800, color: "#000000" }}>
                  {line.odds}
                </span>
              </div>
            </div>
            {idx < lines.length - 1 ? <FullWidthHyphenRule /> : null}
          </div>
        ))
      )}

      <Divider />

      <Row label="Bets" value={String(lines.length)} />
      <Row label="Stake" value={formatCurrency(ticket.stake)} />
      <Row label="Total Odds" value={formatOdds(ticket.totalOdds)} />
      {showTax ? (
        <>
          <Row
            label={won ? "Winning amount" : "Possible Win"}
            value={formatCurrency(gross)}
          />
          {taxHelper ? (
            <div style={{ fontWeight: 700, margin: "1mm 0" }}>{taxHelper}</div>
          ) : null}
          <Row
            label={won ? "Net payout" : "If won, net"}
            value={formatCurrency(
              won && ticket.netPayout > 0 ? ticket.netPayout : net,
            )}
            bold
          />
        </>
      ) : (
        <Row
          label="Possible Win"
          value={formatCurrency(ticket.potentialWin)}
          bold
        />
      )}

      <Divider />

      {barcodeDataUrl ? (
        <div style={{ textAlign: "center", marginTop: "2mm" }}>
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

      <TicketFooter />
    </div>
  );
});

function ReceiptCouponRow({ receipt, coupon }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "2mm",
        fontWeight: 800,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "#000000" }}>
        Receipt:{" "}
        <span style={{ fontFamily: "'Courier New', monospace" }}>{receipt}</span>
      </span>
      <span style={{ color: "#000000" }}>
        Coupon:{" "}
        <span style={{ fontFamily: "'Courier New', monospace" }}>{coupon}</span>
      </span>
    </div>
  );
}

function TicketFooter() {
  return (
    <div
      style={{
        marginTop: "2mm",
        textAlign: "center",
        fontSize: "10px",
        fontWeight: 700,
        lineHeight: 1.4,
        color: "#000000",
      }}
    >
      {TICKET_FOOTER_LINES.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

function Row({ label, value, mono = false, bold = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "2mm",
        fontWeight: bold ? 800 : 700,
      }}
    >
      <span style={{ color: "#000000", fontWeight: "inherit" }}>{label}</span>
      <span
        style={{
          color: "#000000",
          fontWeight: "inherit",
          fontFamily: mono ? "'Courier New', monospace" : undefined,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function BranchRow({ value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "2mm",
        alignItems: "flex-start",
      }}
    >
      <span style={{ color: "#000000", flexShrink: 0, fontWeight: 700 }}>
        Branch
      </span>
      <span
        style={{
          flex: 1,
          color: "#000000",
          fontWeight: 700,
          fontFamily: "'Courier New', monospace",
          textAlign: "right",
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        borderTop: "1px dashed #000",
        margin: "1.5mm 0",
      }}
    />
  );
}

/**
 * Full-width separator between games. Uses a real border (not overflow-clipped
 * hyphen text) so html2pdf/html2canvas, @media print, and system PDF drivers
 * render it the same as on screen.
 */
function FullWidthHyphenRule() {
  return (
    <div
      aria-hidden
      className="ticket-game-separator"
      style={{
        clear: "both",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        margin: "1.5mm 0",
        padding: 0,
        border: "none",
        borderTop: "1px dashed #000",
        minHeight: "1px",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    />
  );
}

export default TicketTemplate;
