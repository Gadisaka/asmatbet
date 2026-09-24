/** Aligns with player `winningsTax` utils — cashier receipts use ticket snapshot when present. */

export function winningsTaxRateDecimal(winningsTax) {
  if (!winningsTax?.enabled) return 0;
  const r = Number(winningsTax.rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return r;
}

export function formatWinningsTaxPercent(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return null;
  const pct = r * 100;
  const rounded = Math.round(pct * 100) / 100;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
}

/** Player-facing helper, e.g. "Tax 15% - 12.50 Birr". */
export function winningsTaxHelperText(rate, taxAmount, currency = "Birr") {
  const pct = formatWinningsTaxPercent(rate);
  const amt = Number(taxAmount);
  if (!pct || !Number.isFinite(amt) || amt <= 0) return null;
  return `Tax ${pct}% - ${amt.toFixed(2)} ${currency}`;
}

export function isWonTicketStatus(status) {
  const s = String(status || "").toUpperCase();
  return s === "WON" || s === "PAID";
}

export function slipGrossTaxNetForTicket(possibleWin, ticketLike) {
  if (possibleWin == null || possibleWin === "") {
    return { tax: null, net: null, gross: null };
  }
  const grossNum = Number(possibleWin);
  if (!Number.isFinite(grossNum)) {
    return { tax: null, net: null, gross: null };
  }
  const apply = Boolean(
    ticketLike?.applyWinningsTax ?? ticketLike?.apply_winnings_tax,
  );
  const rateRaw = ticketLike?.winningsTaxRate ?? ticketLike?.winnings_tax_rate;
  const rate = rateRaw != null && Number.isFinite(Number(rateRaw)) ? Number(rateRaw) : 0;
  if (!apply || rate <= 0) {
    return { tax: 0, net: grossNum, gross: grossNum };
  }
  const tax = Math.round(grossNum * rate * 100) / 100;
  const net = Math.round((grossNum - tax) * 100) / 100;
  return { tax, net, gross: grossNum };
}

export function formatTaxLineLabel(ticketLike, platformTax) {
  const r = Number(
    ticketLike?.winningsTaxRate ?? ticketLike?.winnings_tax_rate,
  );
  const pct = formatWinningsTaxPercent(r);
  if (pct) return `Tax ${pct}%`;
  if (platformTax?.enabled && winningsTaxRateDecimal(platformTax) > 0) {
    const p = formatWinningsTaxPercent(winningsTaxRateDecimal(platformTax));
    if (p) return `Tax ${p}%`;
  }
  return "Tax";
}

export function formatTicketTaxHelper(ticketLike, platformTax = null) {
  const status = String(ticketLike?.status || "").toUpperCase();
  if (
    status &&
    !["OPEN", "PRINTED", "HELD", "WON", "PAID"].includes(status)
  ) {
    return null;
  }

  const fromApi = String(ticketLike?.winningsTaxHelper || "").trim();
  if (fromApi) return fromApi;

  const { tax } = slipGrossTaxNetForTicket(
    ticketLike?.potentialWin ?? ticketLike?.potential_win,
    ticketLike,
  );
  const snapshotRate = Number(
    ticketLike?.winningsTaxRate ?? ticketLike?.winnings_tax_rate,
  );
  if (Number.isFinite(snapshotRate) && snapshotRate > 0 && tax > 0) {
    return winningsTaxHelperText(snapshotRate, tax);
  }
  const platformRate = winningsTaxRateDecimal(platformTax);
  if (tax > 0 && platformRate > 0) {
    return winningsTaxHelperText(platformRate, tax);
  }
  return null;
}
