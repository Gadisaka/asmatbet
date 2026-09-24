import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AppIcon from "../common/AppIcon";
import BetPlacementPrinterOverlay from "../common/BetPlacementPrinterOverlay";
import CouponCheckPreview from "../common/CouponCheckPreview";
import {
  fetchPublicCouponTicket,
  fetchPublicCouponCheck,
  hasAuthToken,
  placeBet,
} from "../../services/api";
import {
  isSelectionExpired,
  slipHasExpiredSelection,
} from "../../utils/selectionExpiry";
import {
  clampStakeToUpperBound,
  parseStakeNumeric,
  capGrossPotentialWin,
  stakeAndPotentialWinViolation,
  stakeBoundsInvalid,
  stakeLimitsHintParts,
} from "../../utils/stakeLimits";
import { mapCouponSelectionsToSlipRows } from "../../utils/couponTicketToSlip";
import { formatCouponNumberInput } from "../../utils/couponNumber";
import { slipGrossTaxNet, winningsTaxLabel } from "../../utils/winningsTax";
import { useActiveBonuses } from "../../hooks/useActiveBonuses";
import {
  accumulatorBonusExtraGrossFormatted,
  accumulatorPercentFromBonusesList,
} from "../../utils/accumulatorBonus";
import { useOddsSocket } from "../../hooks/useOddsSocket";

const modalBackdrop =
  "fixed inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm";

const modalPanel =
  "relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.25rem] bg-gradient-to-br from-[#111111]/96 via-[#111111]/98 to-[#000000]/96 px-5 pb-5 pt-10 text-[#ffffff]  shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]";

const modalPanelMd =
  "relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[1.25rem] bg-gradient-to-br from-[#111111]/96 via-[#111111]/98 to-[#000000]/96 text-[#ffffff]  shadow-[0_24px_60px_-12px_rgba(0,0,0,0.65)]";

function ModalClose({ onClick, label = "Close" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border-0 bg-[#0a0a0a]/60 text-lg text-[rgba(255,255,255,0.72)] transition-all hover:bg-[#111111] hover:ring-1 hover:ring-(--sb-accent-fill)/25"
      aria-label={label}
    >
      ✕
    </button>
  );
}

const slipDivider = "border-white/8";

const SHEET_CLOSE_DRAG_PX = 80;
const SHEET_CLOSE_DRAG_RATIO = 0.15;

function computePlacementSnapshot(
  selections,
  stakeNum,
  { limits, activeBonuses, lockedByFixture },
) {
  const hasExpiredSelection = slipHasExpiredSelection(selections);
  const hasLockedSelection = selections.some(
    (sel) =>
      String(sel.marketState || "").toUpperCase() === "LOCKED" ||
      Boolean(lockedByFixture[Number(sel.apiFixtureId)]),
  );
  const totalOddsProduct =
    selections.length && !hasExpiredSelection && !hasLockedSelection
      ? selections.reduce((acc, s) => acc * parseFloat(s.value), 1)
      : null;
  const totalOdds =
    selections.length === 0
      ? "0.00"
      : hasExpiredSelection || hasLockedSelection
        ? "—"
        : totalOddsProduct != null && Number.isFinite(totalOddsProduct)
          ? totalOddsProduct.toFixed(2)
          : "0.00";
  const accPct = accumulatorPercentFromBonusesList(
    activeBonuses,
    selections.length,
  );
  const rawGrossPotentialWin =
    totalOddsProduct != null && Number.isFinite(totalOddsProduct)
      ? stakeNum * totalOddsProduct * (1 + accPct / 100)
      : null;
  const cappedGrossPotentialWin =
    rawGrossPotentialWin != null
      ? capGrossPotentialWin(limits, rawGrossPotentialWin)
      : null;
  const possibleWin =
    cappedGrossPotentialWin != null ? cappedGrossPotentialWin.toFixed(2) : "—";
  return {
    selections: [...selections],
    stake: stakeNum,
    totalOdds,
    maxWin: possibleWin,
    netPay: possibleWin,
  };
}

function MobileBetSlip({
  open,
  onClose,
  selections,
  onRemoveSelection,
  onClearSelections,
  onReplaceSelections = () => {},
  onSelectionClick,
  stakeInput,
  onStakeInputChange,
  limits = null,
  winningsTax = null,
}) {
  const stakeNum = parseStakeNumeric(stakeInput) ?? 0;
  const [placing, setPlacing] = useState(false);
  const [betResult, setBetResult] = useState(null);
  const [placedBet, setPlacedBet] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [copiedCoupon, setCopiedCoupon] = useState(false);
  const [loadCouponInput, setLoadCouponInput] = useState("");
  const [checkCouponInput, setCheckCouponInput] = useState("");
  const [couponLoadingLoad, setCouponLoadingLoad] = useState(false);
  const [couponLoadingCheck, setCouponLoadingCheck] = useState(false);
  const [couponCheckTickets, setCouponCheckTickets] = useState(null);
  const [lockedByFixture, setLockedByFixture] = useState({});
  const isMulti = selections.length > 1;
  const [, setTick] = useState(0);
  const { bonuses: activeBonuses } = useActiveBonuses();
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const dragStartYRef = useRef(0);
  const activePointerIdRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setIsDragging(false);
      activePointerIdRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const handleSheetPointerDown = useCallback(
    (e) => {
      if (!open) return;

      const el = e.target;
      if (el instanceof Element) {
        if (el.closest("button, a, input, textarea, select")) return;

        const inDragZone = el.closest("[data-sheet-drag]");
        const inScrollAtTop =
          scrollRef.current &&
          scrollRef.current.contains(el) &&
          scrollRef.current.scrollTop <= 0;

        if (!inDragZone && !inScrollAtTop) return;
      } else {
        return;
      }

      activePointerIdRef.current = e.pointerId;
      dragStartYRef.current = e.clientY;
      setIsDragging(true);
      sheetRef.current?.setPointerCapture(e.pointerId);
    },
    [open],
  );

  const handleSheetPointerMove = useCallback((e) => {
    if (activePointerIdRef.current !== e.pointerId) return;
    const deltaY = e.clientY - dragStartYRef.current;
    setDragY(deltaY > 0 ? deltaY : 0);
  }, []);

  const handleSheetPointerEnd = useCallback(
    (e) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      activePointerIdRef.current = null;
      setIsDragging(false);
      sheetRef.current?.releasePointerCapture(e.pointerId);

      const sheetHeight =
        sheetRef.current?.offsetHeight ?? window.innerHeight * 0.8;
      const threshold = Math.max(
        SHEET_CLOSE_DRAG_PX,
        sheetHeight * SHEET_CLOSE_DRAG_RATIO,
      );

      setDragY((current) => {
        if (current > threshold) onClose();
        return 0;
      });
    },
    [onClose],
  );
  const socketFixtureIds = selections
    .map((s) => Number(s.apiFixtureId))
    .filter((id) => Number.isFinite(id));
  useOddsSocket(socketFixtureIds, {
    onLocked: (payload) => {
      const id = Number(payload?.apiFixtureId);
      if (!Number.isFinite(id)) return;
      setLockedByFixture((prev) => ({ ...prev, [id]: true }));
    },
    onUnlocked: (payload) => {
      const id = Number(payload?.apiFixtureId);
      if (!Number.isFinite(id)) return;
      setLockedByFixture((prev) => ({ ...prev, [id]: false }));
    },
  });

  const hasExpiredSelection = slipHasExpiredSelection(selections);
  const hasLockedSelection = selections.some(
    (sel) =>
      String(sel.marketState || "").toUpperCase() === "LOCKED" ||
      Boolean(lockedByFixture[Number(sel.apiFixtureId)]),
  );
  const totalOddsProduct =
    selections.length && !hasExpiredSelection && !hasLockedSelection
      ? selections.reduce((acc, s) => acc * parseFloat(s.value), 1)
      : null;
  const totalOdds =
    selections.length === 0
      ? "0.00"
      : hasExpiredSelection || hasLockedSelection
        ? "—"
        : totalOddsProduct != null && Number.isFinite(totalOddsProduct)
          ? totalOddsProduct.toFixed(2)
          : "0.00";

  const accPct = accumulatorPercentFromBonusesList(
    activeBonuses,
    selections.length,
  );
  const accBonusExtraEtb =
    accPct > 0 &&
    totalOddsProduct != null &&
    Number.isFinite(totalOddsProduct) &&
    !hasExpiredSelection
      ? accumulatorBonusExtraGrossFormatted(stakeNum, totalOddsProduct, accPct)
      : null;

  const rawGrossPotentialWin =
    totalOddsProduct != null && Number.isFinite(totalOddsProduct)
      ? stakeNum * totalOddsProduct * (1 + accPct / 100)
      : null;
  const cappedGrossPotentialWin =
    rawGrossPotentialWin != null
      ? capGrossPotentialWin(limits, rawGrossPotentialWin)
      : null;
  const possibleWin =
    cappedGrossPotentialWin != null ? cappedGrossPotentialWin.toFixed(2) : "—";
  const { tax, netWin } = slipGrossTaxNet(possibleWin, winningsTax);

  const stakeHintParts = stakeLimitsHintParts(limits);
  const stakeViolation =
    selections.length &&
    !hasExpiredSelection &&
    totalOddsProduct != null &&
    Number.isFinite(totalOddsProduct) &&
    cappedGrossPotentialWin != null
      ? stakeAndPotentialWinViolation(limits, stakeNum, cappedGrossPotentialWin)
      : null;

  const stakeFieldInvalid = stakeBoundsInvalid(limits, stakeInput);

  async function handlePlaceBet() {
    if (!selections.length || placing) return;
    if (slipHasExpiredSelection(selections)) {
      setBetResult({
        type: "error",
        message:
          "One or more matches are expired. Remove them before placing your bet.",
      });
      setTimeout(() => setBetResult(null), 4500);
      return;
    }

    const winCheck =
      totalOddsProduct != null && Number.isFinite(totalOddsProduct)
        ? stakeAndPotentialWinViolation(
            limits,
            stakeNum,
            capGrossPotentialWin(
              limits,
              stakeNum * totalOddsProduct * (1 + accPct / 100),
            ),
          )
        : null;
    if (winCheck) {
      setBetResult({
        type: "error",
        message: winCheck,
      });
      setTimeout(() => setBetResult(null), 4500);
      return;
    }

    setPlacing(true);
    setBetResult(null);

    const snapshotCtx = {
      limits,
      winningsTax,
      activeBonuses,
      lockedByFixture,
    };
    const snap = computePlacementSnapshot(selections, stakeNum, snapshotCtx);

    try {
      const data = await placeBet(selections, stakeNum, {
        acceptOddsChanges: false,
        idempotencyKey,
      });
      setIdempotencyKey(null);
      setCopiedCoupon(false);
      setPlacedBet({
        couponNumber: data.couponNumber || data.coupon_number || "",
        receiptNumber: data.receiptNumber ?? data.receipt_number ?? "",
        paidWithWallet: hasAuthToken(),
        ...snap,
      });
      window.dispatchEvent(new Event("balanceUpdated"));
    } catch (err) {
      const driftCodes = new Set(["odds_changed", "market_version_changed"]);
      if (driftCodes.has(String(err?.code || "")) && err?.details) {
        const changed = Array.isArray(err.details.selections)
          ? err.details.selections
          : [];
        const hasInvalidServerOdds = changed.some((row) => {
          const n = Number(row?.serverOdds);
          return !Number.isFinite(n) || n <= 1;
        });
        const hasLiveSelection = selections.some((sel) =>
          Boolean(sel?.fromLive),
        );
        if (hasInvalidServerOdds && !hasLiveSelection) {
          setBetResult({
            type: "error",
            message:
              "One or more markets are temporarily unavailable. Please try again in a moment.",
          });
          setTimeout(() => setBetResult(null), 4500);
          return;
        }
        const updatedSelections = selections.map((sel, idx) => {
          const row = changed.find((entry) => Number(entry.index) === idx);
          if (!row || !Number.isFinite(Number(row.serverOdds))) return sel;
          return {
            ...sel,
            acceptedOdds: Number(row.serverOdds),
            acceptedMarketVersion: Number(
              row.serverMarketVersion ?? sel.marketVersion ?? 0,
            ),
            marketVersion: Number(
              row.serverMarketVersion ?? sel.marketVersion ?? 0,
            ),
            marketState: row.marketState || sel.marketState || "OPEN",
            value: Number(row.serverOdds).toFixed(2),
          };
        });
        const idem = err?.idempotencyKey || idempotencyKey;
        setIdempotencyKey(idem);
        const freezeToken = err.details.freezeToken ?? null;
        try {
          const retry = await placeBet(updatedSelections, stakeNum, {
            acceptOddsChanges: true,
            freezeToken,
            idempotencyKey: idem,
          });
          const snapRetry = computePlacementSnapshot(
            updatedSelections,
            stakeNum,
            snapshotCtx,
          );
          setIdempotencyKey(null);
          setCopiedCoupon(false);
          setPlacedBet({
            couponNumber: retry.couponNumber || retry.coupon_number || "",
            receiptNumber: retry.receiptNumber ?? retry.receipt_number ?? "",
            paidWithWallet: hasAuthToken(),
            ...snapRetry,
            usedLatestOdds: true,
          });
          window.dispatchEvent(new Event("balanceUpdated"));
        } catch (retryErr) {
          setBetResult({
            type: "error",
            message:
              retryErr?.code === "market_locked"
                ? "Market is locked. Try again in a few seconds."
                : retryErr.message,
          });
          setTimeout(() => setBetResult(null), 4000);
        }
        return;
      }
      setBetResult({
        type: "error",
        message:
          err?.code === "market_locked"
            ? "Market is locked. Try again in a few seconds."
            : err.message,
      });
      setTimeout(() => setBetResult(null), 4000);
    } finally {
      setPlacing(false);
    }
  }

  async function handleCopyCoupon() {
    if (placedBet?.paidWithWallet || !placedBet?.couponNumber) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(placedBet.couponNumber);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = placedBet.couponNumber;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setCopiedCoupon(true);
      setTimeout(() => setCopiedCoupon(false), 1500);
    } catch {
      setBetResult({
        type: "error",
        message: "Could not copy coupon number. Please copy manually.",
      });
      setTimeout(() => setBetResult(null), 2500);
    }
  }

  async function handleLoadCouponSubmit() {
    const trimmed = String(loadCouponInput || "").trim();
    if (!trimmed || couponLoadingLoad) return;
    setCouponLoadingLoad(true);
    setBetResult(null);
    try {
      const data = await fetchPublicCouponTicket(trimmed);
      const sourceSelections = data.selections ?? [];
      const rows = mapCouponSelectionsToSlipRows(
        data.couponNumber ?? trimmed,
        sourceSelections,
      );
      if (!rows.length) {
        setBetResult({
          type: "error",
          message: sourceSelections.length
            ? "All selections on this coupon have already started."
            : "This ticket has no selections to load.",
        });
        setTimeout(() => setBetResult(null), 4000);
        return;
      }
      onReplaceSelections(rows);
      setBetResult({
        type: "success",
        message: "Coupon template loaded onto this slip.",
      });
      setTimeout(() => setBetResult(null), 3500);
    } catch (err) {
      setBetResult({
        type: "error",
        message: err?.message || "Could not load coupon.",
      });
      setTimeout(() => setBetResult(null), 4000);
    } finally {
      setCouponLoadingLoad(false);
    }
  }

  async function handleCheckCouponSubmit() {
    const trimmed = String(checkCouponInput || "").trim();
    if (!trimmed || couponLoadingCheck) return;
    setCouponLoadingCheck(true);
    setBetResult(null);
    try {
      const data = await fetchPublicCouponCheck(trimmed);
      setCouponCheckTickets(data.tickets || []);
    } catch (err) {
      setBetResult({
        type: "error",
        message: err?.message || "Ticket not found.",
      });
      setTimeout(() => setBetResult(null), 4500);
    } finally {
      setCouponLoadingCheck(false);
    }
  }

  const couponToolsSection = (
    <div
      className={`space-y-2 border-b bg-[#0a0a0a]/25 px-3 pb-2.5 pt-2 backdrop-blur-sm shrink-0 ${slipDivider}`}
    >
      <div className="flex gap-2">
            <input
              type="text"
              value={loadCouponInput}
              onChange={(e) =>
                setLoadCouponInput(formatCouponNumberInput(e.target.value))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLoadCouponSubmit();
              }}
              placeholder="e.g. 12345-67890"
              disabled={couponLoadingLoad}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-xl border-0 bg-[#0a0a0a]/80 px-3 text-[13px] text-[#ffffff] shadow-inner shadow-black/25 ring-1 ring-white/10 outline-none transition-all placeholder:text-[rgba(255,255,255,0.72)] focus:ring-2 focus:ring-(--sb-accent-fill)/45 disabled:opacity-60"
            />
            <button
              type="button"
              title="Load coupon into bet slip"
              disabled={couponLoadingLoad}
              onClick={handleLoadCouponSubmit}
              className="flex h-10 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-[#0a0a0a]/80 text-[#9aaed1] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/35 disabled:pointer-events-none disabled:opacity-50"
            >
              {couponLoadingLoad ? (
                <span className="text-[10px] font-bold text-[rgba(255,255,255,0.72)]">…</span>
              ) : (
                <AppIcon name="clipboard" size={17} strokeWidth={1.9} />
              )}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={checkCouponInput}
              onChange={(e) =>
                setCheckCouponInput(formatCouponNumberInput(e.target.value))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCheckCouponSubmit();
              }}
              placeholder="Check Coupon..."
              disabled={couponLoadingCheck}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-xl border-0 bg-[#0a0a0a]/80 px-3 text-[13px] text-[#ffffff] shadow-inner shadow-black/25 ring-1 ring-white/10 outline-none transition-all placeholder:text-[rgba(255,255,255,0.72)] focus:ring-2 focus:ring-(--sb-accent-fill)/45 disabled:opacity-60"
            />
            <button
              type="button"
              title="Check coupon status"
              disabled={couponLoadingCheck}
              onClick={handleCheckCouponSubmit}
              className="flex h-10 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-[#0a0a0a]/80 text-[#9aaed1] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/35 disabled:pointer-events-none disabled:opacity-50"
            >
              {couponLoadingCheck ? (
                <span className="text-[10px] font-bold text-[rgba(255,255,255,0.72)]">…</span>
              ) : (
                <AppIcon name="ticket" size={17} strokeWidth={1.9} />
              )}
            </button>
          </div>
    </div>
  );

  return (
    <>
      {createPortal(
        <div
          className={`fixed inset-0 z-[59] transition-opacity duration-300 ease-out lg:hidden ${
            open
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          aria-hidden={!open}
        >
          <button
            type="button"
            className="absolute inset-0 border-0 bg-black/55 backdrop-blur-sm"
            onClick={onClose}
            tabIndex={open ? 0 : -1}
            aria-label="Close betslip"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Betslip"
            className="absolute inset-x-0 bottom-0 z-60 flex h-[80vh] max-h-[80vh] flex-col overflow-hidden rounded-t-[1.75rem] bg-gradient-to-br from-[#111111]/96 via-[#0a0a0a]/96 to-[#000000]/95 shadow-[0_-12px_40px_-8px_rgba(0,0,0,0.55)] backdrop-blur-md lg:hidden"
            style={{
              transform: open ? `translateY(${dragY}px)` : "translateY(100%)",
              transition: isDragging
                ? "none"
                : "transform 300ms ease-in-out",
            }}
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerEnd}
            onPointerCancel={handleSheetPointerEnd}
          >
            <div
              className="flex shrink-0 justify-center pb-1 pt-2.5 touch-none"
              data-sheet-drag
            >
              <div
                className="h-1 w-10 rounded-full bg-white/25"
                aria-hidden
              />
            </div>
            <div
              className={`flex shrink-0 items-center border-b bg-[#0a0a0a]/35 backdrop-blur-md ${slipDivider}`}
              data-sheet-drag
            >
              <button
                type="button"
                className={`mx-0.5 flex-1 cursor-pointer rounded-t-xl border-0 bg-transparent py-3 text-sm font-bold transition-colors ${
                  isMulti
                    ? "text-(--sb-accent-text-on-dark) shadow-[inset_0_-2px_0_0_var(--sb-accent-fill)]"
                    : "text-[rgba(255,255,255,0.72)]"
                }`}
              >
                Multi
              </button>
              <button
                type="button"
                className={`mx-0.5 flex-1 cursor-pointer rounded-t-xl border-0 bg-transparent py-3 text-sm font-bold transition-colors ${
                  !isMulti
                    ? "text-(--sb-accent-text-on-dark) shadow-[inset_0_-2px_0_0_var(--sb-accent-fill)]"
                    : "text-[rgba(255,255,255,0.72)]"
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-[rgba(255,255,255,0.72)] transition-colors hover:bg-[#0a0a0a]/50 hover:text-[#ffffff]"
              >
                <AppIcon name="chevronDown" size={20} />
          </button>
        </div>
        {couponToolsSection}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {selections.map((sel) => {
            const expired = isSelectionExpired(sel);
            const canOpenMatch =
              typeof onSelectionClick === "function" &&
              sel?.apiFixtureId != null;
            return (
              <div
                key={sel.id}
                className={`flex items-center justify-between border-b px-4 py-3 transition-colors ${slipDivider} ${
                  expired ? "bg-[#2a1515]/55" : "active:bg-[#0a0a0a]/20"
                }`}
              >
                <button
                  type="button"
                  disabled={!canOpenMatch}
                  onClick={() => {
                    if (!canOpenMatch) return;
                    onSelectionClick(sel);
                    onClose?.();
                  }}
                  className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-left ${
                    canOpenMatch ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div
                      className={`text-sm font-bold ${
                        expired
                          ? "text-[#f87171] line-through decoration-[#f87171]/80"
                          : "text-[#ffffff]"
                      }`}
                    >
                      {sel.matchName}
                    </div>
                    {expired ? (
                      <span className="rounded bg-[#450a0a] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#fecaca]">
                        Expired
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={`mt-0.5 text-xs ${
                      expired ? "text-[#f87171]/90" : "text-[rgba(255,255,255,0.72)]"
                    }`}
                  >
                    {sel.marketLabel}: {sel.displayLabel || sel.label}
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-extrabold ${
                      expired
                        ? "text-[#f87171]"
                        : "text-(--sb-accent-text-muted)"
                    }`}
                  >
                    {sel.value}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveSelection(sel.id)}
                    className="cursor-pointer border-0 bg-transparent text-[rgba(255,255,255,0.72)] hover:text-[#ff6b6b]"
                  >
                    <AppIcon name="x" size={16} />
                  </button>
                </div>
              </div>
            );
          })}
            </div>
            <div
              className={`shrink-0 border-t bg-[#0a0a0a]/30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm ${slipDivider}`}
            >
          {selections.length > 0 && hasExpiredSelection ? (
            <div className="mb-3 rounded border border-[#3f1d1d] bg-[#1f0a0a] px-3 py-2 text-center text-[11px] font-bold text-[#fecaca]">
              Remove expired matches to place this bet.
            </div>
          ) : null}
          {betResult && (
            <div
              className={`mb-3 rounded px-3 py-2 text-center text-xs font-bold ${
                betResult.type === "success"
                  ? "bg-(--sb-accent-surface) text-(--sb-accent-text-on-dark)"
                  : "bg-[#3a1515] text-[#ff6b6b]"
              }`}
            >
              {betResult.message}
            </div>
          )}
          <div className="mb-3 flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              value={stakeInput}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  onStakeInputChange("");
                  return;
                }
                const n = Number(v);
                if (!Number.isFinite(n)) return;
                onStakeInputChange(String(clampStakeToUpperBound(limits, n)));
              }}
              className={`h-11 min-w-0 flex-1 rounded-2xl border-0 bg-[#0a0a0a]/80 px-3 text-sm font-bold shadow-inner shadow-black/25 ring-1 outline-none transition-all focus:ring-2 ${
                stakeFieldInvalid
                  ? "text-[#fecaca] ring-[#b91c1c]/55 focus:ring-red-500/35"
                  : "text-[#ffffff] ring-white/10 focus:ring-(--sb-accent-fill)/45"
              }`}
            />
            <button
              type="button"
              disabled={
                limits?.MAX_BET_AMOUNT == null ||
                !Number.isFinite(limits.MAX_BET_AMOUNT)
              }
              title="Sets stake to configured maximum bet"
              onClick={() =>
                limits?.MAX_BET_AMOUNT != null &&
                Number.isFinite(limits.MAX_BET_AMOUNT) &&
                onStakeInputChange(String(limits.MAX_BET_AMOUNT))
              }
              className="h-11 shrink-0 cursor-pointer rounded-2xl border-0 bg-(--sb-accent-fill) px-4 text-xs font-extrabold text-(--sb-on-accent) transition-all hover:bg-(--sb-accent-fill-hover) disabled:cursor-not-allowed disabled:opacity-40"
            >
              MAX
            </button>
          </div>
          {stakeHintParts.length > 0 ? (
            <p className="mb-1 text-[10px] leading-snug text-[#6e7ea3]">
              {stakeHintParts.join(" · ")}
            </p>
          ) : null}
          {stakeViolation ? (
            <p className="mb-3 text-[11px] font-semibold leading-snug text-[#ff8a8a]">
              {stakeViolation}
            </p>
          ) : null}

          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-[rgba(255,255,255,0.72)]">Total Odds</span>
              <span className="font-bold text-(--sb-accent-text-muted)">
                {totalOdds}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[rgba(255,255,255,0.72)]">
                {winningsTaxLabel(winningsTax)}
              </span>
              <span className="font-bold text-[#ffffff]">
                {tax === "—" ? "—" : `${tax} ETB`}
              </span>
            </div>
            {accPct > 0 &&
            selections.length > 0 &&
            !hasExpiredSelection &&
            accBonusExtraEtb != null ? (
              <div className="col-span-2 flex justify-between gap-2">
                <span className="text-[rgba(255,255,255,0.72)]">Accumulator bonus</span>
                <span className="flex flex-col items-end font-bold text-[#86efac]">
                  <span>
                    +
                    {Number.isInteger(accPct)
                      ? accPct
                      : Number.parseFloat(Number(accPct).toFixed(2))}
                    %
                  </span>
                  <span className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#a7f3d0]">
                    +{accBonusExtraEtb} ETB
                  </span>
                </span>
              </div>
            ) : null}
            <div className="col-span-2 flex justify-between">
              <span className="font-bold text-(--sb-accent-text-muted)">
                Net win / payout
              </span>
              <span className="font-bold text-(--sb-accent-text-muted)">
                {netWin === "—" ? "—" : `${netWin} ETB`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClearSelections}
              className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border-0 bg-[#0a0a0a]/80 text-[rgba(255,255,255,0.72)] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/25"
            >
              <AppIcon name="trash" size={18} />
            </button>
            <button
              type="button"
              disabled={
                placing ||
                !selections.length ||
                hasExpiredSelection ||
                hasLockedSelection ||
                Boolean(stakeViolation)
              }
              onClick={handlePlaceBet}
              className="h-12 min-w-0 flex-1 cursor-pointer rounded-2xl border-0 bg-(--sb-accent-fill) text-base font-extrabold tracking-wide text-(--sb-on-accent) transition-all hover:bg-(--sb-accent-fill-hover) disabled:pointer-events-none disabled:opacity-50"
            >
              {placing ? "PLACING..." : "PLACE BET"}
            </button>
          </div>
        </div>
          </div>
        </div>,
        document.body,
      )}
      {couponCheckTickets && couponCheckTickets.length > 0 &&
        createPortal(
          <div className={modalBackdrop} style={{ zIndex: 2147483646 }}>
            <div className={modalPanel}>
              <ModalClose
                onClick={() => setCouponCheckTickets(null)}
                label="Close ticket preview"
              />
              <div className="flex justify-center">
                <CouponCheckPreview tickets={couponCheckTickets} />
              </div>
            </div>
          </div>,
          document.body,
        )}
      {((placing && hasAuthToken()) || placedBet?.paidWithWallet) && (
        <BetPlacementPrinterOverlay
          bet={placedBet?.paidWithWallet ? placedBet : null}
          onClose={() => setPlacedBet(null)}
        />
      )}
      {placedBet &&
        !placedBet.paidWithWallet &&
        createPortal(
          <div className={modalBackdrop} style={{ zIndex: 2147483647 }}>
            <div className={`${modalPanelMd} px-5 pb-5 pt-10`}>
              <ModalClose
                onClick={() => setPlacedBet(null)}
                label="Close bet confirmation"
              />

              <div className="z-50 px-6 pb-4 pt-8 text-center">
                <h2 className="text-2xl font-extrabold leading-tight text-(--sb-accent)">
                  Congrats, Your Bet
                  <br />
                  is Booked.
                </h2>

                {placedBet.paidWithWallet ? (
                  <>
                    <p className="mt-4 rounded-lg border border-[#276249]/60 bg-[#0f241a]/80 px-3 py-2.5 text-sm leading-snug text-[#86efac]">
                      Your stake of{" "}
                      <span className="font-bold">{placedBet.stake} ETB</span>{" "}
                      was deducted — your bet is confirmed.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <p className="text-2xl font-bold tracking-wider text-[#ffffff]">
                        {placedBet.couponNumber || "—"}
                      </p>
                      <button
                        type="button"
                        onClick={handleCopyCoupon}
                        title={copiedCoupon ? "Copied" : "Copy coupon number"}
                        aria-label={
                          copiedCoupon
                            ? "Copied to clipboard"
                            : "Copy coupon number"
                        }
                        className="flex cursor-pointer items-center justify-center rounded-xl border-0 bg-[#0a0a0a]/80 p-2 text-[#ffffff] shadow-inner shadow-black/20 ring-1 ring-white/10 transition-all hover:ring-(--sb-accent-fill)/45"
                      >
                        {copiedCoupon ? (
                          <AppIcon
                            name="check"
                            size={16}
                            className="text-(--sb-positive)"
                          />
                        ) : (
                          <AppIcon name="copy" size={16} />
                        )}
                      </button>
                    </div>

                    <p className="mt-4 text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
                      Please find a nearby AsmatBet shop to pay and print your
                      slip.
                    </p>
                  </>
                )}

                {placedBet.usedLatestOdds ? (
                  <p className="mt-3 text-center text-xs font-semibold text-[#9ecbff]">
                    Latest odds used
                  </p>
                ) : null}

                <p className="mt-2 text-xs italic text-(--sb-accent)">
                  All bets after kickoff are INVALID. All Terms and Conditions
                  fully Apply
                </p>
              </div>

              <div className="mx-5 rounded-[1rem] bg-gradient-to-br from-[#151528]/95 to-[#0c101c]/95 px-4 py-3 ring-1 ring-white/10 shadow-inner shadow-black/20">
                {placedBet.paidWithWallet ? (
                  <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                    <span className="text-[rgba(255,255,255,0.72)]">Payment</span>
                    <span className="font-semibold text-[#86efac]">
                      Paid {placedBet.stake} ETB
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                  <span className="text-[rgba(255,255,255,0.72)]">Stake</span>
                  <span className="font-bold">{placedBet.stake} ETB</span>
                </div>
                <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                  <span className="text-[rgba(255,255,255,0.72)]">Max Win</span>
                  <span className="font-bold">{placedBet.maxWin} ETB</span>
                </div>
                <div className="flex justify-between border-b border-[#2a2a3e] py-1.5 text-sm">
                  <span className="text-[rgba(255,255,255,0.72)]">Total Odd</span>
                  <span className="font-bold">{placedBet.totalOdds}</span>
                </div>
                <div className="flex justify-between pt-2 text-sm font-extrabold">
                  <span>Net Pay</span>
                  <span className="text-(--sb-accent)">
                    {placedBet.netPay} ETB
                  </span>
                </div>
              </div>

              <div className="mx-5 mb-5 mt-4 overflow-hidden rounded-[1rem] ring-1 ring-white/10 shadow-inner shadow-black/20">
                <div className="flex items-center justify-between bg-(--sb-accent-fill) px-4 py-2 font-bold text-(--sb-on-accent)">
                  <span>My Games</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/8 bg-[#0a0a0a]/70 text-[rgba(255,255,255,0.72)] backdrop-blur-sm">
                      <th className="px-2 py-2 text-left font-semibold">
                        Date
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">
                        Match
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">
                        Market
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">
                        Your Pick
                      </th>
                      <th className="px-2 py-2 text-right font-semibold">
                        ODD
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {placedBet.selections.map((sel) => (
                      <tr
                        key={sel.id}
                        className="border-b border-[#2a2a3e] text-[#ffffff]"
                      >
                        <td className="whitespace-nowrap px-2 py-2">
                          {new Date().toLocaleDateString()}
                        </td>
                        <td className="px-2 py-2">{sel.matchName}</td>
                        <td className="px-2 py-2">{sel.marketLabel}</td>
                        <td className="px-2 py-2">{sel.displayLabel || sel.label}</td>
                        <td className="px-2 py-2 text-right font-bold">
                          {sel.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default MobileBetSlip;
