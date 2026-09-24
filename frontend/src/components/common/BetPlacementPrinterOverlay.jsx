import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "motion/react";
import AppIcon from "./AppIcon";
import { ReceiptPrinter } from "./ReceiptPrinter";
import { topHeaderData } from "../../data/homepageData";

const PRINT_DURATION_MS = 1750;
const REDUCED_PRINT_DURATION_MS = 200;

function formatEtb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`;
}

function formatOdds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function formatStakeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function DiscoWatchReadout({ stake }) {
  return (
    <p
      className="relative z-10 m-0 truncate px-1 pt-1 text-center text-[11px] font-bold uppercase tracking-[0.18em] text-[#ffb347] tabular-nums [font-family:Orbitron,sans-serif] [text-shadow:0_0_8px_rgba(255,179,71,0.55)]"
      aria-label={`Bet placed with ${formatStakeAmount(stake)}`}
    >
      BET PLACED WITH - {formatStakeAmount(stake)}
    </p>
  );
}

function PaperDivider() {
  return (
    <div aria-hidden className="my-2 border-t border-dashed border-[#9a9a9a]" />
  );
}

function SummaryRow({ label, value, highlight = false }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-1 py-0.5 text-[11px] font-bold ${
        highlight ? "-mx-1 rounded bg-[#e8f6d8] px-2 py-1.5" : ""
      }`}
    >
      <span className="uppercase tracking-wide text-[#555]">{label}</span>
      <span className="font-extrabold text-[#0a0a0a]">{value}</span>
    </div>
  );
}

function BetReceiptPaper({ bet, brand }) {
  const selections = bet?.selections || [];

  return (
    <div className="relative z-10 text-[#0a0a0a]">
      <div className="text-center">
        <p className="m-0 text-base font-black uppercase tracking-[0.35em] text-[#0a0a0a]">
          {brand}
        </p>
        <p className="mt-2 break-all text-sm font-extrabold tracking-[0.12em]">
          {bet?.receiptNumber || "—"}
        </p>
      </div>

      <PaperDivider />

      <p className="m-0 text-center text-[10px] font-bold uppercase tracking-[0.25em] text-[#555]">
        Selections
      </p>

      <PaperDivider />

      <div className="space-y-2">
        {selections.map((sel, idx) => {
          const pick = String(sel.displayLabel || sel.label || "").trim() || "-";
          const market = String(sel.marketLabel ?? "").trim() || "-";
          return (
            <div key={sel.id || idx} className="px-0.5">
              <div className="text-[12px] font-extrabold leading-snug">
                {idx + 1}. {sel.matchName}
              </div>
              <div className="mt-0.5 flex items-end justify-between gap-3">
                <span className="min-w-0 flex-1 break-words text-[11px] font-bold">
                  {market}
                </span>
                <span className="shrink-0 text-[11px] font-black">{pick}</span>
              </div>
              <div className="mt-0.5 text-right text-[11px] font-black">
                {formatOdds(sel.value)}
              </div>
            </div>
          );
        })}
      </div>

      <PaperDivider />

      <div className="space-y-0.5">
        <SummaryRow label="No. matches" value={String(selections.length)} />
        <SummaryRow label="Stake" value={formatEtb(bet?.stake)} />
        <SummaryRow label="Total odd" value={formatOdds(bet?.totalOdds)} />
        <SummaryRow label="Max win" value={formatEtb(bet?.maxWin)} />
        <SummaryRow label="Net pay" value={formatEtb(bet?.netPay)} highlight />
      </div>

      {bet?.usedLatestOdds ? (
        <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-wide text-[#555]">
          Latest odds used
        </p>
      ) : null}

      <p className="mt-3 text-center text-[9px] leading-snug text-[#666]">
        All bets after kickoff are INVALID. All Terms and Conditions fully Apply
      </p>
    </div>
  );
}

function BetPlacementPrinterOverlay({ bet, onClose }) {
  const shouldReduceMotion = useReducedMotion();
  const [stage, setStage] = useState("processing");
  const brand = topHeaderData.brand || "AsmatBet";
  const canDismiss = stage === "complete";

  useEffect(() => {
    if (!bet) {
      setStage("processing");
      return undefined;
    }

    setStage("printing");
    const delay = shouldReduceMotion
      ? REDUCED_PRINT_DURATION_MS
      : PRINT_DURATION_MS;
    const timer = window.setTimeout(() => setStage("complete"), delay);
    return () => window.clearTimeout(timer);
  }, [bet, shouldReduceMotion]);

  function handleBackdropClick(event) {
    if (!canDismiss) return;
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div className="relative max-h-[90vh] w-full max-w-sm overflow-y-auto">
        {canDismiss ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-1 top-1 z-[60] flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-[#0a0a0a]/70 text-[rgba(255,255,255,0.72)] transition-all hover:bg-[#111111]"
            aria-label="Close bet confirmation"
          >
            <AppIcon name="x" size={16} />
          </button>
        ) : null}

        <ReceiptPrinter.Root stage={stage} aria-label={`${brand} receipt printer`}>
          <ReceiptPrinter.Machine>
            <ReceiptPrinter.Header>
              <p className="relative z-10 m-0 px-1 text-sm font-black uppercase tracking-[0.28em] text-(--sb-text)">
                {brand}
              </p>
              <p className="relative z-10 m-0 pr-10 pt-0.5 text-[11px] font-black uppercase tracking-[0.16em] text-(--sb-accent-fill)">
                Success
              </p>
            </ReceiptPrinter.Header>
            {bet ? <DiscoWatchReadout stake={bet.stake} /> : null}
          </ReceiptPrinter.Machine>
          <ReceiptPrinter.Output>
            <ReceiptPrinter.Paper>
              <BetReceiptPaper bet={bet} brand={brand} />
            </ReceiptPrinter.Paper>
          </ReceiptPrinter.Output>
        </ReceiptPrinter.Root>
      </div>
    </div>,
    document.body,
  );
}

export default BetPlacementPrinterOverlay;
