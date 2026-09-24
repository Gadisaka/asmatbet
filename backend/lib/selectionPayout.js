/**
 * Shared leg-payout math for settlement and cashback.
 *
 * `result_factor` is the fraction of stake that participates in the result
 * (OddsPapi HALFWIN/HALFLOSS). Null on old rows means a full result.
 */

function resultOf(selection) {
  return String(selection?.result || "").toUpperCase();
}

/** Stake participation: 1 full, 0.5 half, 0 void. */
export function selectionResultFactor(selection) {
  const result = resultOf(selection);
  if (result === "VOID") return 0;
  const raw = selection?.result_factor;
  if (raw == null || raw === "") {
    return result === "PENDING" ? 0 : 1;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

/** True when the leg zeros a parlay (full loss, not half-loss). */
export function isFullLoss(selection) {
  return resultOf(selection) === "LOST" && selectionResultFactor(selection) >= 1;
}

/**
 * Decimal multiplier this leg contributes to ticket combined odds.
 *
 * VOID → 1
 * WON  → 1 + (odds - 1) * factor   (full win = odds, half-win = (odds+1)/2)
 * LOST → 1 - factor                (full loss = 0, half-loss = 0.5)
 */
export function legPayoutMultiplier(selection) {
  const result = resultOf(selection);
  if (result === "VOID") return 1;
  const odds = Number(selection?.odds);
  const safeOdds = Number.isFinite(odds) && odds > 0 ? odds : 1;
  if (result === "PENDING") return safeOdds;
  const factor = selectionResultFactor(selection);
  if (result === "LOST") return Math.max(0, 1 - factor);
  if (result === "WON") return 1 + (safeOdds - 1) * factor;
  return safeOdds;
}

/** Combined odds for display / cashback on LOST tickets: VOID and half-loss skip, full loss keeps original odds, wins use payout factor. */
export function listedCombinedOdds(selections) {
  if (!Array.isArray(selections) || selections.length === 0) return 1;
  let product = 1;
  for (const sel of selections) {
    const result = resultOf(sel);
    if (result === "VOID") continue;
    if (result === "LOST" && selectionResultFactor(sel) < 1) continue;
    const odds = Number(sel?.odds);
    if (!Number.isFinite(odds) || odds <= 0) continue;
    product *= result === "WON" ? legPayoutMultiplier(sel) : odds;
  }
  return product;
}

/** Odds product for cashback: VOID and half-loss skip; full loss keeps original odds. */
export function cashbackLegOdds(selection) {
  const result = resultOf(selection);
  if (result === "VOID") return null;
  if (result === "LOST" && selectionResultFactor(selection) < 1) return null;
  const odds = Number(selection?.odds);
  if (!Number.isFinite(odds) || odds <= 0) return null;
  if (result === "WON") return legPayoutMultiplier(selection);
  return odds;
}
