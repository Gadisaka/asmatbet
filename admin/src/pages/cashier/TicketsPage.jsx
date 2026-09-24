import { useEffect, useRef, useState } from "react";
import AdminShell from "../../components/layout/AdminShell";
import PanelCard from "../../components/ui/PanelCard";
import Modal from "../../components/ui/Modal";
import TicketTemplate from "../../components/ticket/TicketTemplate";
import PayoutReceiptTemplate from "../../components/ticket/PayoutReceiptTemplate";
import { useTicketPrint } from "../../components/ticket/useTicketPrint";
import { usePayoutReceiptPrint } from "../../components/ticket/usePayoutReceiptPrint";
import { encodeTicketAsync } from "../../components/ticket/escpos";
import { print as printViaLocalService } from "../../services/localPrinter";
import { useAuth } from "../../context/AuthContext";
import { API_URL } from "../../../constants.js";
import {
  useCashoutQuoteMutation,
  mapTicketDetail,
  useCancelTicketMutation,
  useConfirmPrintedTicketMutation,
  useCouponLookupMutation,
  useExecuteCashoutMutation,
  usePayoutTicketMutation,
  usePreparePrintTicketMutation,
  useReceiptLookupMutation,
  useRemoveTicketSelectionMutation,
  useAddTicketSelectionMutation,
  useRepeatTicketMutation,
  useTicketByIdLookupMutation,
  useTodayTicketsQuery,
  useUpdateTicketStakeMutation,
} from "../../hook/useCashierTickets";
import { useCashierHistoryQuery } from "../../hook/useCashierWallet";
import { useNotificationUnreadCountQuery } from "../../hook/useNotifications";
import { usePlayerInfoPagesQuery } from "../../hook/useSettingsQuery";
import CashierInboxList from "../../components/notifications/CashierInboxList";
import FixturesSelectionPanel from "../../components/cashier/FixturesSelectionPanel";
import {
  formatSelectionResult,
  sortSelectionsByOdds,
} from "../../components/ticket/receiptFormat";
import { capGrossPotentialWin } from "../../utils/bettingStakeLimits";
import {
  isSelectionRemovable,
  isSelectionStarted,
} from "../../utils/selectionExpiry";
import { formatCouponNumberInput } from "../../utils/couponNumber";
import {
  formatTicketTaxHelper,
  isWonTicketStatus,
  slipGrossTaxNetForTicket,
  winningsTaxHelperText,
} from "../../utils/winningsTax";

const STARTED_SELECTION_PRUNE_MS = 15_000;

function getStartedSelectionIds(ticket, now = Date.now()) {
  return (ticket?.selections || [])
    .filter((selection) => isSelectionStarted(selection.match?.startTime, now))
    .map((selection) => selection.id)
    .filter(Boolean);
}

function canEditSellSelections(ticket, sellConfirmed) {
  return (
    ticket?.status === "OPEN" &&
    !sellConfirmed &&
    isFirstSaleTicket(ticket)
  );
}

const LEFT_TABS = [
  { id: "sell", label: "Sell Ticket" },
  { id: "payout", label: "Payout and Cancel" },
];

const RIGHT_TABS = [
  { id: "inbox", label: "Inbox" },
  { id: "canceled", label: "Canceled Slips" },
  { id: "all", label: "All Slips" },
];

const PRINTED_STORAGE_KEY = "cashier:printedTicketIds";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return `${toNumber(value).toLocaleString()} ETB`;
}

const PRINT_DRIFT_CODES = new Set(["odds_changed", "market_version_changed"]);

function buildAcceptDriftSelections(changedRows, ticket) {
  const snapshotSelections = Array.isArray(ticket?.selections)
    ? ticket.selections
    : [];
  return changedRows.map((row) => {
    const idx = Number(row.index);
    const fromTicket = snapshotSelections[idx];
    const acceptedOdds = Number.isFinite(Number(row.serverOdds))
      ? Number(row.serverOdds)
      : Number(fromTicket?.odds);
    return {
      index: idx,
      acceptedOdds,
      acceptedMarketVersion:
        row.serverMarketVersion ??
        row.submittedMarketVersion ??
        fromTicket?.marketVersion ??
        null,
    };
  });
}

function printDriftConfirmMessage(code) {
  if (code === "market_version_changed") {
    return "Market data was refreshed. Click OK to accept the latest market and continue printing.";
  }
  return "Ticket odds changed. Click OK to accept the latest odds and continue printing.";
}

function printDriftCancelMessage(code) {
  if (code === "market_version_changed") {
    return "Printing canceled. Review updated market and try again.";
  }
  return "Printing canceled. Review updated odds and try again.";
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function readPrintedCache() {
  try {
    const raw = localStorage.getItem(PRINTED_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writePrintedCache(setValue) {
  localStorage.setItem(PRINTED_STORAGE_KEY, JSON.stringify([...setValue]));
}

function selectionResultClass(result) {
  const value = String(result || "PENDING").toUpperCase();
  if (value === "WON") return "text-emerald-600";
  if (value === "LOST") return "text-[var(--danger)]";
  if (value === "VOID") return "text-[var(--muted)]";
  return "text-[var(--muted)]";
}

function TicketStatusBadge({ status }) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAID") {
    return (
      <span className="rounded-sm bg-emerald-600/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
        Paid
      </span>
    );
  }
  if (normalized === "EXPIRED") {
    return (
      <span className="rounded-sm bg-[var(--surfaceMuted)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        Expired
      </span>
    );
  }
  return <span className="font-mono">{normalized || "-"}</span>;
}

function isFirstSaleTicket(ticket) {
  return (
    ticket?.status === "OPEN" && !String(ticket?.receiptNumber ?? "").trim()
  );
}

function TicketSummary({
  ticket,
  platformWinningsTax = null,
  className = "",
}) {
  if (!ticket) return null;

  const { tax, net, gross } = slipGrossTaxNetForTicket(
    ticket.potentialWin,
    ticket,
  );
  const won = isWonTicketStatus(ticket.status);
  const appliedTax =
    won && Number(ticket.winningsTaxAmount) > 0
      ? Number(ticket.winningsTaxAmount)
      : 0;
  const taxHelper = formatTicketTaxHelper(ticket, platformWinningsTax);
  const showAppliedTax = appliedTax > 0;

  return (
    <div className={`space-y-1 text-sm ${className}`}>
      <p>
        <span className="font-semibold">Stake:</span>{" "}
        {formatCurrency(ticket.stake)}
      </p>
      <p>
        <span className="font-semibold">Total Odds:</span>{" "}
        {toNumber(ticket.totalOdds).toFixed(2)}
      </p>
      <p>
        <span className="font-semibold">
          {won ? "Winning amount:" : "Possible Win:"}
        </span>{" "}
        {formatCurrency(gross ?? ticket.potentialWin)}
      </p>
      {taxHelper ? (
        <p className="text-[var(--muted)]">
          <span className="font-semibold text-[var(--foreground)]">
            {taxHelper}
          </span>
        </p>
      ) : null}
      {showAppliedTax ? (
        <p>
          <span className="font-semibold">Net payout:</span>{" "}
          {formatCurrency(ticket.netPayout > 0 ? ticket.netPayout : net)}
        </p>
      ) : tax != null && tax > 0 && !won ? (
        <p>
          <span className="font-semibold">If won, net:</span>{" "}
          {formatCurrency(net)}
        </p>
      ) : null}
      <p>
        <span className="font-semibold">Status:</span>{" "}
        <TicketStatusBadge status={ticket.status} />
      </p>
    </div>
  );
}

function TicketDetail({
  ticket,
  platformWinningsTax = null,
  canRemoveSelections = false,
  onRemoveSelection,
  removingSelectionId = "",
  showSelectionResults = false,
  hideSummary = false,
}) {
  if (!ticket) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-sm border border-[var(--border)]">
      <div className="border-b border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        <span className="block font-mono normal-case">
          Coupon {ticket.couponNumber}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Market</th>
              <th className="px-3 py-2">Selection</th>
              <th className="px-3 py-2">Odd</th>
              {showSelectionResults ? (
                <th className="px-3 py-2">Result</th>
              ) : null}
              {canRemoveSelections ? (
                <th className="px-3 py-2 text-right">Action</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sortSelectionsByOdds(ticket.selections || []).map((selection) => {
              const home = selection.match?.homeTeam ?? "";
              const away = selection.match?.awayTeam ?? "";
              const matchLabel =
                selection.match && String(away).trim()
                  ? `${home} vs ${away}`
                  : selection.match
                    ? home || "-"
                    : "-";
              const marketText = String(selection.marketLabel ?? "").trim();
              const started = isSelectionStarted(selection.match?.startTime);
              const startingSoon =
                !started && isSelectionRemovable(selection.match?.startTime);
              const isRemoving = removingSelectionId === selection.id;
              return (
                <tr
                  key={selection.id}
                  className={`border-b border-[var(--border)] last:border-0 ${
                    started || startingSoon ? "bg-[var(--surfaceMuted)]/40" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {selection.match?.startTime
                      ? new Date(selection.match.startTime).toLocaleString()
                      : "-"}
                    {started ? (
                      <span className="mt-0.5 block text-[10px] font-semibold uppercase text-[var(--danger)]">
                        Started
                      </span>
                    ) : startingSoon ? (
                      <span className="mt-0.5 block text-[10px] font-semibold uppercase text-[var(--danger)]">
                        Starting soon
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{matchLabel}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {marketText || "-"}
                  </td>
                  <td className="px-3 py-2 text-xs">{selection.selection}</td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {toNumber(selection.odds).toFixed(2)}
                  </td>
                  {showSelectionResults ? (
                    <td
                      className={`px-3 py-2 text-xs font-semibold ${selectionResultClass(selection.result)}`}
                    >
                      {formatSelectionResult(selection.result)}
                    </td>
                  ) : null}
                  {canRemoveSelections ? (
                    <td className="px-3 py-2 text-right text-xs">
                      <button
                        type="button"
                        disabled={Boolean(removingSelectionId)}
                        onClick={() => onRemoveSelection?.(selection.id)}
                        className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--danger)] disabled:opacity-50"
                      >
                        {isRemoving ? "Removing..." : "Remove"}
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!hideSummary ? (
        <TicketSummary
          ticket={ticket}
          platformWinningsTax={platformWinningsTax}
          className="border-t border-[var(--border)] px-3 py-3"
        />
      ) : null}
    </div>
  );
}

function canRepeatSlip(ticket) {
  const status = String(ticket?.status || "").toUpperCase();
  return (
    ticket?.printed &&
    status !== "CANCELED" &&
    status !== "EXPIRED"
  );
}

function SlipsTable({
  items,
  page,
  totalPages,
  onPageChange,
  onRepeat,
  onUseCoupon,
}) {
  return (
    <PanelCard className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-3">Time</th>
              <th className="px-3 py-3">Coupon</th>
              <th className="px-3 py-3">Amount</th>
              <th className="px-3 py-3">Possible Win</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Printed</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-xs text-[var(--muted)]"
                >
                  No slips found for today.
                </td>
              </tr>
            ) : (
              items.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-3 py-3 text-xs">
                    {formatTime(ticket.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => onUseCoupon(ticket)}
                      className="text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      {ticket.couponNumber}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {toNumber(ticket.stake).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {formatCurrency(ticket.potentialWin)}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <TicketStatusBadge status={ticket.status} />
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {canRepeatSlip(ticket) ? (
                      <button
                        type="button"
                        className="rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-2 py-1 text-[11px] font-semibold"
                        onClick={() => onRepeat(ticket)}
                      >
                        Repeat
                      </button>
                    ) : ticket.printed ? (
                      <span className="text-[var(--muted)]">Yes</span>
                    ) : (
                      <span className="text-[var(--muted)]">No</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-3 py-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            className="rounded-sm border border-[var(--border)] px-2 py-1 disabled:opacity-50"
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </button>
          <span className="text-[var(--muted)]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            className="rounded-sm border border-[var(--border)] px-2 py-1 disabled:opacity-50"
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </PanelCard>
  );
}

export default function CashierTicketsPage() {
  const { user, logout } = useAuth();
  const [leftTab, setLeftTab] = useState("sell");
  const [rightTab, setRightTab] = useState("inbox");
  const [slipsPage, setSlipsPage] = useState(1);

  const [sellCouponInput, setSellCouponInput] = useState("");
  const [payoutReceiptInput, setPayoutReceiptInput] = useState("");
  const [sellTicket, setSellTicket] = useState(null);
  const [sellStakeInput, setSellStakeInput] = useState("");
  const [payoutTicket, setPayoutTicket] = useState(null);
  const [payoutQuote, setPayoutQuote] = useState(null);
  const [payoutAction, setPayoutAction] = useState("payout");
  const [sellError, setSellError] = useState("");
  const [payoutError, setPayoutError] = useState("");
  const [sellConfirmed, setSellConfirmed] = useState(false);
  const [ticketPreviewOpen, setTicketPreviewOpen] = useState(false);
  const [payoutReceiptPreviewOpen, setPayoutReceiptPreviewOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [printedCache, setPrintedCache] = useState(() => readPrintedCache());
  const [platformWinningsTax, setPlatformWinningsTax] = useState(null);
  const [bettingLimits, setBettingLimits] = useState(null);
  const [removingSelectionId, setRemovingSelectionId] = useState("");
  const [fixturesPanelOpen, setFixturesPanelOpen] = useState(false);
  const [addSelectionError, setAddSelectionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/cms/platform-config`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (data?.winningsTax) {
            setPlatformWinningsTax(data.winningsTax);
          }
          if (data?.limits != null) {
            setBettingLimits(data.limits);
          }
        }
      } catch {
        if (!cancelled) {
          setPlatformWinningsTax(null);
          setBettingLimits(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lookupCoupon = useCouponLookupMutation();
  const lookupReceipt = useReceiptLookupMutation();
  const loadTicketById = useTicketByIdLookupMutation();
  const cancelTicket = useCancelTicketMutation();
  const payoutTicketMutation = usePayoutTicketMutation();
  const cashoutQuoteMutation = useCashoutQuoteMutation();
  const executeCashoutMutation = useExecuteCashoutMutation();
  const confirmPrint = useConfirmPrintedTicketMutation();
  const preparePrint = usePreparePrintTicketMutation();
  const updateStake = useUpdateTicketStakeMutation();
  const repeatTicket = useRepeatTicketMutation();
  const removeSelection = useRemoveTicketSelectionMutation();
  const addSelection = useAddTicketSelectionMutation();
  const printInFlightRef = useRef(false);
  const pruningStartedRef = useRef(false);
  const playerInfoPagesQuery = usePlayerInfoPagesQuery();
  const payoutContactEntries =
    playerInfoPagesQuery.data?.pages?.["contact-us"]?.entries ?? [];

  const sellStakeNum = Number(sellStakeInput);
  const sellAccPct = toNumber(sellTicket?.accumulatorBonusPercent);
  const sellRawGrossPotential =
    sellTicket &&
    Number.isFinite(sellStakeNum) &&
    sellStakeNum > 0 &&
    Number.isFinite(toNumber(sellTicket.totalOdds))
      ? sellStakeNum * toNumber(sellTicket.totalOdds) * (1 + sellAccPct / 100)
      : 0;
  const sellCappedPossibleWin = capGrossPotentialWin(
    bettingLimits,
    sellRawGrossPotential,
  );
  const sellTaxBreakdown = slipGrossTaxNetForTicket(
    sellCappedPossibleWin,
    sellTicket,
  );
  const sellShowTax = sellTaxBreakdown.tax != null && sellTaxBreakdown.tax > 0;
  const sellTaxHelper = sellShowTax
    ? winningsTaxHelperText(
        sellTicket?.winningsTaxRate ?? platformWinningsTax?.rate,
        sellTaxBreakdown.tax,
      )
    : null;

  const ticketForPrint = sellTicket
    ? {
        ...sellTicket,
        cashierId: sellTicket.cashierId || user?.cashierId || user?.id || "",
        cashierName:
          String(sellTicket.cashierName || "").trim() || user?.name || "",
      }
    : null;
  const {
    ticketRef,
    barcodeDataUrl,
    downloadPdf,
    pdfBusy,
    printerStatus,
    refreshPrinterStatus,
    testPrint,
    lastError: printError,
  } = useTicketPrint(ticketForPrint, {
    width: "80mm",
    platformWinningsTax,
  });

  const ticketForPayoutReceipt = payoutTicket
    ? {
        ...payoutTicket,
        paidByName: user?.name || payoutTicket.cashierName || "",
      }
    : null;
  const {
    receiptRef: payoutReceiptRef,
    barcodeDataUrl: payoutBarcodeDataUrl,
    downloadPdf: downloadPayoutPdf,
    pdfBusy: payoutPdfBusy,
    print: printPayoutReceipt,
    lastError: payoutPrintError,
  } = usePayoutReceiptPrint(ticketForPayoutReceipt, {
    width: "80mm",
    platformWinningsTax,
    contactEntries: payoutContactEntries,
    paidByName: user?.name || "",
  });

  const slipsStatus = rightTab === "canceled" ? "CANCELED" : "";
  const slipsEnabled = rightTab !== "inbox";
  const walletQuery = useCashierHistoryQuery({ page: 1 });
  const cashierBalance = walletQuery.data?.balance;
  const slipsQuery = useTodayTicketsQuery({
    status: slipsStatus,
    page: slipsPage,
    limit: 10,
    enabled: slipsEnabled,
  });
  const unreadQuery = useNotificationUnreadCountQuery();
  const inboxUnread = unreadQuery.data?.count ?? 0;

  const slipsItems = Array.isArray(slipsQuery.data?.items)
    ? slipsQuery.data.items
    : [];
  const slipsData = slipsItems.map((ticket) => ({
    ...ticket,
    printed: ticket.printed || printedCache.has(ticket.id),
  }));

  const totalPages = slipsQuery.data?.totalPages || 1;
  const isBusy =
    lookupCoupon.isPending ||
    lookupReceipt.isPending ||
    loadTicketById.isPending ||
    cancelTicket.isPending ||
    payoutTicketMutation.isPending ||
    cashoutQuoteMutation.isPending ||
    executeCashoutMutation.isPending ||
    confirmPrint.isPending ||
    preparePrint.isPending ||
    updateStake.isPending ||
    repeatTicket.isPending ||
    removeSelection.isPending ||
    addSelection.isPending;
  const printerConnected = Boolean(printerStatus?.connected);
  const printerPort = printerStatus?.port || "";
  const printerQueueLength = Number(printerStatus?.queueLength) || 0;
  const printerProcessing = Boolean(printerStatus?.processing);
  const printerLastError = printerStatus?.lastError || "";
  const printerQueueActive = printerProcessing || printerQueueLength > 0;

  const setPrintedTicket = (ticketId) => {
    setPrintedCache((prev) => {
      const next = new Set(prev);
      next.add(ticketId);
      writePrintedCache(next);
      return next;
    });
  };

  const pruneStartedSellSelections = async (ticket, { announce = true } = {}) => {
    if (!ticket?.id || !canEditSellSelections(ticket, false)) {
      return ticket;
    }

    const startedIds = getStartedSelectionIds(ticket);
    if (startedIds.length === 0) return ticket;

    const remainingCount = (ticket.selections || []).length - startedIds.length;
    if (remainingCount < 1) {
      if (announce) {
        setSellError(
          "All selections on this ticket have already started. Reject it or add new selections.",
        );
      }
      return ticket;
    }

    if (pruningStartedRef.current) return ticket;
    pruningStartedRef.current = true;
    setRemovingSelectionId(startedIds[0]);
    try {
      let updated = ticket;
      let removed = 0;
      for (const selectionId of startedIds) {
        const stillStarted = getStartedSelectionIds(updated);
        if (!stillStarted.includes(selectionId)) continue;
        if ((updated.selections || []).length <= 1) break;
        updated = await removeSelection.mutateAsync({
          ticketId: updated.id,
          selectionId,
        });
        removed += 1;
      }
      if (removed > 0) {
        setSellTicket(updated);
        setSellConfirmed(false);
        if (announce) {
          setActionSuccess(
            removed === 1
              ? "Removed 1 started selection. Review updated odds and confirm."
              : `Removed ${removed} started selections. Review updated odds and confirm.`,
          );
        }
      }
      return updated;
    } catch (error) {
      setSellError(error?.message || "Failed to remove started selections");
      return ticket;
    } finally {
      pruningStartedRef.current = false;
      setRemovingSelectionId("");
    }
  };

  const loadCouponTicket = async ({
    type,
    couponNumber,
    receiptNumber,
    payoutMode = "payout",
  }) => {
    const isSell = type === "sell";
    const trimmedCoupon = String(couponNumber || "").trim();
    const trimmedReceipt = String(receiptNumber || "").trim();
    if (isSell && !trimmedCoupon) return;
    if (!isSell && !trimmedReceipt) return;

    setActionSuccess("");
    if (isSell) {
      setSellError("");
      setSellConfirmed(false);
      setTicketPreviewOpen(false);
    } else {
      setPayoutError("");
      setPayoutQuote(null);
    }

    try {
      if (isSell) {
        const ticket = await lookupCoupon.mutateAsync(trimmedCoupon);
        setSellTicket(ticket);
        setSellStakeInput(String(toNumber(ticket?.stake)));
        await pruneStartedSellSelections(ticket);
      } else {
        const ticket = await lookupReceipt.mutateAsync(trimmedReceipt);
        setPayoutTicket(ticket);
        if (payoutMode === "cashout") {
          const quotePayload = await cashoutQuoteMutation.mutateAsync(
            ticket.id,
          );
          setPayoutQuote(quotePayload?.quote || null);
        }
      }
    } catch (error) {
      if (isSell) {
        setSellTicket(null);
        setSellStakeInput("");
        setSellError(error?.message || "Failed to load ticket");
      } else {
        setPayoutTicket(null);
        setPayoutQuote(null);
        setPayoutError(error?.message || "Failed to load ticket");
      }
    }
  };

  const handleCouponLookup = async (type) => {
    if (type === "sell") {
      await loadCouponTicket({
        type: "sell",
        couponNumber: sellCouponInput,
        payoutMode: payoutAction,
      });
    } else {
      await loadCouponTicket({
        type: "payout",
        receiptNumber: payoutReceiptInput,
        payoutMode: payoutAction,
      });
    }
  };

  const handleSellConfirm = async () => {
    if (!sellTicket) return;
    setSellError("");

    const parsedStake = Number(sellStakeInput);
    if (!Number.isFinite(parsedStake) || parsedStake <= 0) {
      setSellError("Stake must be a positive number");
      return;
    }

    const currentStake = toNumber(sellTicket.stake);
    if (parsedStake !== currentStake) {
      try {
        const updated = await updateStake.mutateAsync({
          ticketId: sellTicket.id,
          stake: parsedStake,
        });
        setSellTicket(updated);
      } catch (error) {
        setSellError(error?.message || "Failed to update stake");
        return;
      }
    }

    setSellConfirmed(true);
    setActionSuccess("Ticket confirmed. You can print now.");
  };

  const handleSellRepeat = async () => {
    if (!sellTicket) return;
    setSellError("");

    const parsedStake = Number(sellStakeInput);
    if (!Number.isFinite(parsedStake) || parsedStake <= 0) {
      setSellError("Stake must be a positive number");
      return;
    }

    try {
      let newTicket = await repeatTicket.mutateAsync(sellTicket.id);
      const currentStake = toNumber(newTicket.stake);
      if (parsedStake !== currentStake) {
        newTicket = await updateStake.mutateAsync({
          ticketId: newTicket.id,
          stake: parsedStake,
        });
      }
      setSellTicket(newTicket);
      setSellCouponInput(formatCouponNumberInput(newTicket.couponNumber || ""));
      setSellConfirmed(true);
      setActionSuccess("New ticket ready. You can print now.");
    } catch (error) {
      setSellError(error?.message || "Failed to repeat ticket");
    }
  };

  const handlePrint = async () => {
    if (!sellTicket || printInFlightRef.current) return;
    printInFlightRef.current = true;
    setSellError("");
    const ticketForWalletAndPrint = sellTicket;

    const runWithDriftRetry = async (mutateAsync, basePayload) => {
      try {
        return await mutateAsync(basePayload);
      } catch (error) {
        const driftCode = String(error?.code || "");
        if (PRINT_DRIFT_CODES.has(driftCode) && error?.details) {
          const changedRows = Array.isArray(error.details.selections)
            ? error.details.selections
            : [];
          const shouldAccept = window.confirm(printDriftConfirmMessage(driftCode));
          if (!shouldAccept) {
            throw Object.assign(new Error(printDriftCancelMessage(driftCode)), {
              handled: true,
            });
          }
          return mutateAsync({
            ...basePayload,
            acceptOddsChanges: true,
            selections: buildAcceptDriftSelections(
              changedRows,
              ticketForWalletAndPrint,
            ),
          });
        }
        throw error;
      }
    };

    try {
      // Fail fast when the printer is offline — before any network call.
      if (!printerConnected) {
        setSellError(
          "Printer offline. Ensure local print service is running and POS80 printer is connected.",
        );
        setTicketPreviewOpen(false);
        return;
      }

      const stakeAmount = toNumber(ticketForWalletAndPrint.stake);
      if (
        cashierBalance != null &&
        Number.isFinite(stakeAmount) &&
        toNumber(cashierBalance) < stakeAmount
      ) {
        setSellError("Insufficient cashier balance");
        setActionSuccess("");
        setTicketPreviewOpen(false);
        return;
      }

      // Single pre-print round trip: prepare-print validates odds/markets,
      // checks cashier balance, and reserves the receipt number.
      setActionSuccess("Validating ticket before print...");
      const prepareResult = await runWithDriftRetry(preparePrint.mutateAsync, {
        ticketId: ticketForWalletAndPrint.id,
      });
      const ticketToPrint = prepareResult?.ticket
        ? mapTicketDetail(prepareResult.ticket)
        : ticketForWalletAndPrint;

      setActionSuccess("Sending ticket to printer...");
      const escposData = await encodeTicketAsync(ticketToPrint, {
        width: "80mm",
        platformWinningsTax,
      });
      const localPrintResult = await printViaLocalService(escposData);
      if (!localPrintResult.success) {
        const localError = String(
          localPrintResult.error?.message ||
            "Failed to send ticket to local printer service.",
        );
        setActionSuccess("");
        if (localPrintResult.code === "service_unreachable") {
          setSellError(
            "Local print service unreachable. Start PrinterBridge.exe on this PC.",
          );
        } else if (localPrintResult.code === "com_unavailable") {
          setSellError(
            "Printer queue unavailable. Check POS80 is installed in Windows Print queues.",
          );
        } else {
          setSellError(localError);
        }
        setTicketPreviewOpen(false);
        return;
      }

      setActionSuccess("Print sent. Confirming sale...");
      let confirmResult;
      try {
        confirmResult = await runWithDriftRetry(confirmPrint.mutateAsync, {
          ticketId: ticketForWalletAndPrint.id,
        });
      } catch (error) {
        if (error?.code === "status_conflict") {
          const existing = await loadTicketById.mutateAsync(
            ticketForWalletAndPrint.id,
          );
          if (existing?.status === "PRINTED") {
            confirmResult = {
              alreadyPrinted: true,
              deductedAmount: 0,
              ticket: existing,
            };
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      setPrintedTicket(ticketForWalletAndPrint.id);

      let updatedTicket;
      if (confirmResult?.ticket) {
        updatedTicket = mapTicketDetail(confirmResult.ticket);
      } else {
        updatedTicket = await loadTicketById.mutateAsync(
          ticketForWalletAndPrint.id,
        );
      }
      setSellTicket(updatedTicket);

      // Fire-and-forget: don't block the cashier on post-sale refetches.
      Promise.all([slipsQuery.refetch(), walletQuery.refetch()]).catch(() => {});

      const walletMessage = confirmResult.alreadyPrinted
        ? "Ticket already confirmed; wallet was not deducted again."
        : `Wallet deducted by ${formatCurrency(confirmResult.deductedAmount)}.`;

      setTicketPreviewOpen(false);
      setActionSuccess(`${walletMessage} Ticket printed successfully.`);
    } catch (error) {
      if (error?.handled) {
        setSellError(error.message);
      } else {
        setSellError(error?.message || "Failed to print ticket");
      }
      setActionSuccess("");
      setTicketPreviewOpen(false);
      if (
        /insufficient/i.test(String(error?.message || "")) &&
        ticketForWalletAndPrint?.id
      ) {
        try {
          const refreshed = await loadTicketById.mutateAsync(
            ticketForWalletAndPrint.id,
          );
          setSellTicket(refreshed);
        } catch {
          /* keep current ticket if refresh fails */
        }
        Promise.all([slipsQuery.refetch(), walletQuery.refetch()]).catch(
          () => {},
        );
      }
    } finally {
      printInFlightRef.current = false;
    }
  };

  const refreshPayoutTicket = async (ticket) => {
    const r = String(ticket?.receiptNumber || "").trim();
    if (!r) throw new Error("Receipt number missing on ticket");
    return lookupReceipt.mutateAsync(r);
  };

  const handleCancelTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    try {
      const response = await cancelTicket.mutateAsync(payoutTicket.id);
      setActionSuccess(response?.message || "Ticket canceled");
      const refreshed = await refreshPayoutTicket(payoutTicket);
      setPayoutTicket(refreshed);
      await slipsQuery.refetch();
    } catch (error) {
      setPayoutError(error?.message || "Failed to cancel ticket");
    }
  };

  const handlePayoutTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    try {
      const response = await payoutTicketMutation.mutateAsync({
        ticketId: payoutTicket.id,
      });
      setActionSuccess(response?.message || "Ticket payout completed");
      if (response?.ticket) {
        setPayoutTicket(response.ticket);
      } else {
        const refreshed = await refreshPayoutTicket(payoutTicket);
        setPayoutTicket(refreshed);
      }
      await slipsQuery.refetch();
    } catch (error) {
      if (error?.details?.ticket) {
        setPayoutTicket(mapTicketDetail(error.details.ticket));
      }
      setPayoutError(error?.message || "Failed to payout ticket");
    }
  };

  const handleCashoutTicket = async () => {
    if (!payoutTicket) return;
    setPayoutError("");
    try {
      const response = await executeCashoutMutation.mutateAsync(
        payoutTicket.id,
      );
      setActionSuccess(response?.message || "Ticket cashout completed");
      const refreshed = await refreshPayoutTicket(payoutTicket);
      setPayoutTicket(refreshed);
      setPayoutQuote(response?.quote || null);
      await slipsQuery.refetch();
    } catch (error) {
      setPayoutError(error?.message || "Failed to cash out ticket");
    }
  };

  const handleUseCouponFromTable = (ticket) => {
    if (!ticket?.id) return;
    setSellCouponInput(formatCouponNumberInput(ticket.couponNumber || ""));
    if (leftTab === "sell") {
      void (async () => {
        setSellError("");
        setSellConfirmed(false);
        try {
          const detail = await loadTicketById.mutateAsync(ticket.id);
          setSellTicket(detail);
          setSellStakeInput(String(toNumber(detail?.stake)));
        } catch (e) {
          setSellError(e?.message || "Failed to load ticket");
        }
      })();
    } else {
      if (!String(ticket.receiptNumber || "").trim()) {
        setPayoutError(
          "This slip has no receipt yet. Print or complete payment first.",
        );
        return;
      }
      void loadCouponTicket({
        type: "payout",
        receiptNumber: ticket.receiptNumber,
        payoutMode: payoutAction,
      });
      setPayoutReceiptInput(
        formatCouponNumberInput(ticket.receiptNumber || ""),
      );
    }
  };

  const handleRepeat = (ticket) => {
    if (!ticket?.id) return;
    setLeftTab("sell");
    setSellCouponInput(formatCouponNumberInput(ticket.couponNumber || ""));
    setSellTicket(null);
    setSellStakeInput("");
    setSellConfirmed(false);
    setTicketPreviewOpen(false);
    setSellError("");
    setActionSuccess("");
    void (async () => {
      try {
        const newTicket = await repeatTicket.mutateAsync(ticket.id);
        setSellTicket(newTicket);
        setSellCouponInput(
          formatCouponNumberInput(newTicket.couponNumber || ""),
        );
        setSellStakeInput(String(toNumber(newTicket.stake)));
        setSellConfirmed(true);
        setActionSuccess("New ticket ready. You can print now.");
      } catch (error) {
        setSellTicket(null);
        setSellStakeInput("");
        setSellConfirmed(false);
        setSellError(error?.message || "Failed to repeat ticket");
      }
    })();
  };

  const handleRemoveSelection = async (selectionId) => {
    if (!sellTicket?.id || !selectionId) return;
    setSellError("");
    setRemovingSelectionId(selectionId);
    try {
      const updated = await removeSelection.mutateAsync({
        ticketId: sellTicket.id,
        selectionId,
      });
      setSellTicket(updated);
      setSellConfirmed(false);
      setActionSuccess("Selection removed. Review updated odds and confirm.");
    } catch (error) {
      setSellError(error?.message || "Failed to remove selection");
    } finally {
      setRemovingSelectionId("");
    }
  };

  const handleAddSelection = async (selection) => {
    if (!sellTicket?.id || !selection) return;
    setSellError("");
    setAddSelectionError("");
    try {
      const updated = await addSelection.mutateAsync({
        ticketId: sellTicket.id,
        selection,
      });
      setSellTicket(updated);
      setSellConfirmed(false);
      setActionSuccess("Selection added. Review updated odds and confirm.");
    } catch (error) {
      const message = error?.message || "Failed to add selection";
      setAddSelectionError(message);
      setSellError(message);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadQuote() {
      if (payoutAction !== "cashout" || !payoutTicket?.id) return;
      try {
        const payload = await cashoutQuoteMutation.mutateAsync(payoutTicket.id);
        if (!cancelled) {
          setPayoutQuote(payload?.quote || null);
        }
      } catch (error) {
        if (!cancelled) {
          setPayoutQuote(null);
          setPayoutError(error?.message || "Failed to load cashout quote");
        }
      }
    }
    void loadQuote();
    return () => {
      cancelled = true;
    };
  }, [payoutAction, payoutTicket?.id]);

  useEffect(() => {
    if (!canEditSellSelections(sellTicket, sellConfirmed)) return undefined;

    const tick = () => {
      if (!sellTicket || pruningStartedRef.current) return;
      if (getStartedSelectionIds(sellTicket).length === 0) return;
      void pruneStartedSellSelections(sellTicket, { announce: true });
    };

    const id = window.setInterval(tick, STARTED_SELECTION_PRUNE_MS);
    return () => window.clearInterval(id);
  }, [sellTicket, sellConfirmed]);

  return (
    <AdminShell user={user} onLogout={logout}>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Cashier Tickets</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sell tickets, process payout/cancel, and monitor today slips.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          <PanelCard className="min-w-[12rem] shrink-0 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Current Cashier Balance
            </p>
            <p className="mt-1 text-2xl font-bold">
              {cashierBalance == null ? (
                <span className="text-sm font-normal text-[var(--muted)]">
                  Loading balance...
                </span>
              ) : (
                <>
                  {toNumber(cashierBalance).toLocaleString()}{" "}
                  <span className="text-sm font-normal text-[var(--muted)]">
                    ETB
                  </span>
                </>
              )}
            </p>
          </PanelCard>

          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-2 text-sm">
            <span className="font-semibold text-[var(--muted)]">Printer:</span>
            {printerConnected ? (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  Printer Connected
                  {printerPort ? (
                    <span className="text-xs text-[var(--muted)]">
                      ({printerPort || "POS80"})
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">(POS80)</span>
                  )}
                </span>
                {printerQueueActive ? (
                  <span className="text-xs text-[var(--muted)]">
                    Printing…
                    {printerQueueLength > 0
                      ? ` (${printerQueueLength} queued)`
                      : ""}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void testPrint()}
                  className="rounded-sm border border-[var(--border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--surface)]"
                >
                  Test Print
                </button>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-[var(--muted)]">
                  <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                  Printer Offline
                  {printerPort ? (
                    <span className="text-xs">({printerPort})</span>
                  ) : null}
                </span>
                {printerLastError ? (
                  <span className="text-xs text-[var(--muted)]">
                    {printerLastError}
                  </span>
                ) : null}
              </>
            )}
            <button
              type="button"
              onClick={() => void refreshPrinterStatus()}
              className="rounded-sm border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
            >
              Refresh
            </button>
            {printError && (
              <span className="text-xs text-[var(--danger)]">{printError}</span>
            )}
          </div>
        </div>
      </div>

      {actionSuccess && (
        <div className="mb-4 rounded-sm border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700">
          {actionSuccess}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <PanelCard className="p-0">
            <div className="flex border-b border-[var(--border)]">
              {LEFT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLeftTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-semibold ${
                    leftTab === tab.id
                      ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {leftTab === "sell" ? (
              <div className="p-4">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!isBusy) void handleCouponLookup("sell");
                  }}
                >
                  <input
                    type="text"
                    value={sellCouponInput}
                    onChange={(event) =>
                      setSellCouponInput(formatCouponNumberInput(event.target.value))
                    }
                    placeholder="e.g. 12345-67890"
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
                    disabled={isBusy}
                  >
                    Search
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {sellTicket && isFirstSaleTicket(sellTicket) ? (
                    <button
                      type="button"
                      onClick={handleSellConfirm}
                      disabled={!sellTicket || isBusy || sellConfirmed}
                      className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {updateStake.isPending ? "Saving..." : "Confirm"}
                    </button>
                  ) : sellTicket ? (
                    <button
                      type="button"
                      onClick={handleSellRepeat}
                      disabled={!sellTicket || isBusy || sellConfirmed}
                      className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {repeatTicket.isPending
                        ? "Repeating..."
                        : updateStake.isPending
                          ? "Saving..."
                          : "Repeat"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handlePrint}
                    disabled={!sellTicket || !sellConfirmed || isBusy}
                    className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    Print Ticket
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      Edit Stake (ETB)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={sellStakeInput}
                      onChange={(event) =>
                        setSellStakeInput(event.target.value)
                      }
                      disabled={!sellTicket || sellConfirmed || isBusy}
                      className="w-36 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSellTicket(null);
                      setSellStakeInput("");
                      setSellConfirmed(false);
                      setTicketPreviewOpen(false);
                      setFixturesPanelOpen(false);
                      setAddSelectionError("");
                      setSellError("");
                      setActionSuccess("");
                    }}
                    disabled={!sellTicket}
                    className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>

                {sellError && (
                  <p className="mt-3 text-xs text-[var(--danger)]">
                    {sellError}
                  </p>
                )}

                {!sellTicket ? (
                  <div className="mt-4 rounded-sm border border-dashed border-[var(--border)] px-4 py-12 text-center text-sm text-[var(--muted)]">
                    Please provide valid ticket number.
                  </div>
                ) : (
                  <>
                    <TicketSummary
                      ticket={sellTicket}
                      platformWinningsTax={platformWinningsTax}
                      className="mt-4 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-3"
                    />

                    <div className="mt-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] px-3 py-3">
                      {sellShowTax ? (
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--muted)]">
                              Possible win
                            </span>
                            <span className="font-semibold text-[var(--foreground)]">
                              {formatCurrency(sellTaxBreakdown.gross)}
                            </span>
                          </div>
                          {sellTaxHelper ? (
                            <p className="font-semibold text-[var(--foreground)]">
                              {sellTaxHelper}
                            </p>
                          ) : null}
                          <div className="flex justify-between gap-4 border-t border-[var(--border)] pt-1">
                            <span className="font-semibold text-[var(--muted)]">
                              If won, net
                            </span>
                            <span className="font-semibold text-[var(--foreground)]">
                              {formatCurrency(sellTaxBreakdown.net)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--muted)]">
                          Possible Win:{" "}
                          <span className="font-semibold text-[var(--foreground)]">
                            {formatCurrency(sellCappedPossibleWin)}
                          </span>
                        </p>
                      )}
                      {sellConfirmed && (
                        <p className="mt-2 text-[11px] text-[var(--muted)]">
                          Stake is locked once the ticket is confirmed.
                        </p>
                      )}
                    </div>

                    <TicketDetail
                      ticket={sellTicket}
                      platformWinningsTax={platformWinningsTax}
                      canRemoveSelections={
                        sellTicket.status === "OPEN" && !sellConfirmed
                      }
                      onRemoveSelection={handleRemoveSelection}
                      removingSelectionId={removingSelectionId}
                      hideSummary
                    />

                    {sellTicket.status === "OPEN" && !sellConfirmed ? (
                      <FixturesSelectionPanel
                        open={fixturesPanelOpen}
                        ticket={sellTicket}
                        onAddSelection={handleAddSelection}
                        adding={addSelection.isPending}
                        error={addSelectionError}
                      />
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div className="p-4">
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!isBusy) void handleCouponLookup("payout");
                  }}
                >
                  <select
                    value={payoutAction}
                    onChange={(event) => {
                      setPayoutAction(event.target.value);
                      setPayoutQuote(null);
                    }}
                    disabled={isBusy}
                    className="min-w-[8.5rem] rounded-sm border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-[var(--accent)] disabled:opacity-60"
                  >
                    <option value="payout" className="bg-slate-900 text-white">
                      Payout
                    </option>
                    <option value="cancel" className="bg-slate-900 text-white">
                      Cancel
                    </option>
                    <option value="cashout" className="bg-slate-900 text-white">
                      Cash Out
                    </option>
                  </select>
                  <input
                    type="text"
                    value={payoutReceiptInput}
                    onChange={(event) =>
                      setPayoutReceiptInput(
                        formatCouponNumberInput(event.target.value),
                      )
                    }
                    placeholder="Receipt #####-#####"
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="submit"
                    className="rounded-sm border border-[var(--border)] px-3 py-2 text-sm"
                    disabled={isBusy}
                  >
                    Search
                  </button>
                </form>

                {payoutError && (
                  <p className="mt-3 text-xs text-[var(--danger)]">
                    {payoutError}
                  </p>
                )}

                {!payoutTicket ? (
                  <div className="mt-4 rounded-sm border border-dashed border-[var(--border)] px-4 py-12 text-center text-sm text-[var(--muted)]">
                    Please provide valid receipt number.
                  </div>
                ) : (
                  <>
                    <TicketDetail
                      ticket={payoutTicket}
                      platformWinningsTax={platformWinningsTax}
                      showSelectionResults
                    />

                    <div className="mt-4 flex flex-wrap items-end gap-3">
                      {payoutTicket.status === "PAID" ? (
                        <button
                          type="button"
                          onClick={() => setPayoutReceiptPreviewOpen(true)}
                          className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)]"
                        >
                          Print Payment Receipt
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (payoutAction === "payout") {
                            void handlePayoutTicket();
                          } else if (payoutAction === "cancel") {
                            void handleCancelTicket();
                          } else if (payoutAction === "cashout") {
                            void handleCashoutTicket();
                          }
                        }}
                        disabled={
                          isBusy ||
                          (payoutAction === "payout" &&
                            payoutTicket.status !== "WON") ||
                          (payoutAction === "cashout" &&
                            payoutQuote &&
                            !payoutQuote.allowed)
                        }
                        className={`rounded-sm px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                          payoutAction === "cancel"
                            ? "bg-red-500"
                            : "bg-[var(--accent)]"
                        }`}
                      >
                        {payoutAction === "cancel"
                          ? "Cancel Ticket"
                          : payoutAction === "cashout"
                            ? "Execute Cash Out"
                            : "Pay Winner"}
                      </button>
                    </div>

                    {payoutAction === "cashout" && payoutQuote && (
                      <div className="mt-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)] p-3 text-xs">
                        <p>
                          Cashout amount:{" "}
                          <span className="font-semibold">
                            {formatCurrency(payoutQuote.amount)}
                          </span>
                        </p>
                        <p className="mt-1 text-[var(--muted)]">
                          Won odds:{" "}
                          {toNumber(payoutQuote.breakdown?.currentOdds).toFixed(
                            2,
                          )}{" "}
                          | Margin:{" "}
                          {toNumber(payoutQuote.breakdown?.margin).toFixed(3)}
                        </p>
                        {!payoutQuote.allowed && (
                          <p className="mt-1 text-[var(--danger)]">
                            Not eligible (
                            {payoutQuote.reasonCode || "unavailable"}).
                          </p>
                        )}
                      </div>
                    )}

                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      Current status:{" "}
                      <TicketStatusBadge status={payoutTicket.status} />
                      {payoutAction === "payout" &&
                        payoutTicket.status !== "WON" && (
                          <>
                            {" "}
                            &middot; Payout is only available for WON tickets.
                          </>
                        )}
                      {payoutAction === "cancel" &&
                        payoutTicket.status !== "OPEN" &&
                        payoutTicket.status !== "PRINTED" && (
                          <>
                            {" "}
                            &middot; Cancel is only available for OPEN or
                            PRINTED (sold) tickets.
                          </>
                        )}
                      {payoutAction === "cashout" && (
                        <>
                          {" "}
                          &middot; Cashout value is calculated by the server and
                          cannot be edited.
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>
            )}
          </PanelCard>
        </div>

        <div className="space-y-4">
          <PanelCard className="p-0">
            <div className="bg-[#04113d] px-3 py-3 text-xs font-semibold text-white">
              Click the button below to launch the game fixtures
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setLeftTab("sell");
                    setFixturesPanelOpen(true);
                  }}
                  className="rounded-sm border border-blue-400 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Launch Fixtures
                </button>
              </div>
            </div>
            <div className="border-t border-[var(--border)] px-3 py-3">
              <h3 className="text-2xl font-semibold">Today Slips</h3>
              <div className="mt-2 flex border-b border-[var(--border)]">
                {RIGHT_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setRightTab(tab.id);
                      setSlipsPage(1);
                    }}
                    className={`relative px-3 py-2 text-xs font-semibold ${
                      rightTab === tab.id
                        ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {tab.label}
                    {tab.id === "inbox" && inboxUnread > 0 ? (
                      <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--accent)] px-1 py-0.5 text-[10px] font-bold text-white">
                        {inboxUnread > 99 ? "99+" : inboxUnread}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {rightTab === "inbox" ? (
                <CashierInboxList />
              ) : (
                <div className="mt-3">
                  {!slipsEnabled ||
                  !slipsQuery.isFetching ||
                  slipsData.length > 0 ? null : (
                    <p className="mb-2 text-xs text-[var(--muted)]">
                      Loading slips...
                    </p>
                  )}
                  <SlipsTable
                    items={slipsData}
                    page={slipsPage}
                    totalPages={totalPages}
                    onPageChange={setSlipsPage}
                    onRepeat={handleRepeat}
                    onUseCoupon={handleUseCouponFromTable}
                  />
                </div>
              )}
            </div>
          </PanelCard>
        </div>
      </div>

      <Modal
        open={ticketPreviewOpen}
        onClose={() => setTicketPreviewOpen(false)}
        title="Ticket Preview"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            Confirm the ticket layout below, then download the PDF for printing.
          </p>
          <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-[var(--border)] bg-[#f2f2f2] p-3">
            {ticketForPrint ? (
              <TicketTemplate
                ticket={ticketForPrint}
                barcodeDataUrl={barcodeDataUrl}
                width="80mm"
                platformWinningsTax={platformWinningsTax}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No ticket available for preview.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setTicketPreviewOpen(false)}
              className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={pdfBusy || !ticketForPrint}
              onClick={async () => {
                const ok = await downloadPdf();
                if (ok) {
                  setActionSuccess("Ticket PDF downloaded. Print it directly.");
                } else {
                  setSellError("Failed to generate ticket PDF");
                }
              }}
              className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pdfBusy ? "Generating PDF..." : "Download PDF"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={payoutReceiptPreviewOpen}
        onClose={() => setPayoutReceiptPreviewOpen(false)}
        title="Payment Receipt Preview"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            Confirm the payment receipt layout below, then print or download the
            PDF.
          </p>
          {payoutPrintError ? (
            <p className="text-xs text-[var(--danger)]">{payoutPrintError}</p>
          ) : null}
          <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-[var(--border)] bg-[#f2f2f2] p-3">
            {ticketForPayoutReceipt ? (
              <PayoutReceiptTemplate
                ticket={ticketForPayoutReceipt}
                barcodeDataUrl={payoutBarcodeDataUrl}
                width="80mm"
                platformWinningsTax={platformWinningsTax}
                contactEntries={payoutContactEntries}
                paidByName={user?.name || ""}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No payment receipt available for preview.
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPayoutReceiptPreviewOpen(false)}
              className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={payoutPdfBusy || !ticketForPayoutReceipt}
              onClick={async () => {
                const ok = await downloadPayoutPdf();
                if (ok) {
                  setActionSuccess("Payment receipt PDF downloaded.");
                } else {
                  setPayoutError("Failed to generate payment receipt PDF");
                }
              }}
              className="rounded-sm border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] disabled:opacity-60"
            >
              {payoutPdfBusy ? "Generating PDF..." : "Download PDF"}
            </button>
            <button
              type="button"
              disabled={!ticketForPayoutReceipt}
              onClick={async () => {
                const result = await printPayoutReceipt();
                if (result.printed) {
                  setActionSuccess("Payment receipt sent to printer.");
                } else if (result.reason === "service_unreachable") {
                  setPayoutError(
                    "Local print service unreachable. Download PDF or start PrinterBridge.exe.",
                  );
                }
              }}
              className="rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Print Receipt
            </button>
          </div>
        </div>
      </Modal>

      <div className="thermal-print-area" aria-hidden>
        {ticketForPrint && (
          <TicketTemplate
            ref={ticketRef}
            ticket={ticketForPrint}
            barcodeDataUrl={barcodeDataUrl}
            width="80mm"
            platformWinningsTax={platformWinningsTax}
          />
        )}
        {ticketForPayoutReceipt && (
          <PayoutReceiptTemplate
            ref={payoutReceiptRef}
            ticket={ticketForPayoutReceipt}
            barcodeDataUrl={payoutBarcodeDataUrl}
            width="80mm"
            platformWinningsTax={platformWinningsTax}
            contactEntries={payoutContactEntries}
            paidByName={user?.name || ""}
          />
        )}
      </div>
    </AdminShell>
  );
}
