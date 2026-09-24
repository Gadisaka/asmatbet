/**
 * Winnings (income) tax — admin-configured, snapshotted per ticket at creation.
 * Stored in `settings` table as two keys.
 *
 * Applied tax is withheld only when a ticket is WON or PAID, from
 * `potential_win` (the settled winning amount). Open / lost / void tickets
 * are not taxed. Helper copy ("Tax 15% - 12.50 Birr") is estimated for
 * still-open tickets so slips can show what will be withheld if they win.
 */
import { toMoney as decimalToMoney, d } from "./moneyDecimal.js";

export const WINNINGS_TAX_ENABLED_SETTING_KEY = "WINNINGS_TAX_ENABLED";
export const WINNINGS_TAX_RATE_SETTING_KEY = "WINNINGS_TAX_RATE";

/** When settings rows are missing, match previous hardcoded sportsbook behavior. */
export const DEFAULT_WINNINGS_TAX_ENABLED = true;
export const DEFAULT_WINNINGS_TAX_RATE = 0.15;
export const MIN_WINNINGS_TAX_RATE = 0;
export const MAX_WINNINGS_TAX_RATE = 0.95;

/** Statuses that actually withhold tax from the winning amount. */
export const WINNINGS_TAX_APPLIED_STATUSES = new Set(["WON", "PAID"]);

/** Statuses that may show an estimated tax helper (if they win). */
export const WINNINGS_TAX_ESTIMATE_STATUSES = new Set([
  "OPEN",
  "PRINTED",
  "HELD",
  "WON",
  "PAID",
]);

export function toMoney(value) {
  return decimalToMoney(value);
}

export function ticketStatusUpper(ticketOrStatus) {
  if (ticketOrStatus && typeof ticketOrStatus === "object") {
    return String(ticketOrStatus.status || "").toUpperCase();
  }
  return String(ticketOrStatus || "").toUpperCase();
}

export function isWinningsTaxAppliedStatus(status) {
  return WINNINGS_TAX_APPLIED_STATUSES.has(ticketStatusUpper(status));
}

/**
 * @param {number} gross
 * @param {boolean} apply
 * @param {number|null|undefined} rate decimal, e.g. 0.15
 */
export function computeWinningsTaxBreakdown(gross, apply, rate) {
  const g = toMoney(gross);
  if (
    !apply ||
    rate == null ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return { taxAmount: 0, netPayout: g };
  }
  const taxAmount = toMoney(d(g).mul(rate));
  const netPayout = toMoney(d(g).sub(taxAmount));
  return { taxAmount, netPayout };
}

export function formatWinningsTaxPercent(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return null;
  const pct = r * 100;
  const rounded = Math.round(pct * 100) / 100;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(2);
}

/**
 * Player-facing helper, e.g. "Tax 15% - 12.50 Birr".
 *
 * @param {number|null|undefined} rate
 * @param {number|null|undefined} taxAmount
 * @param {string} [currency]
 */
export function formatWinningsTaxHelperText(
  rate,
  taxAmount,
  currency = "Birr",
) {
  const pct = formatWinningsTaxPercent(rate);
  const amt = toMoney(taxAmount);
  if (!pct || amt <= 0) return null;
  return `Tax ${pct}% - ${amt.toFixed(2)} ${currency}`;
}

function parseEnabledFromStored(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

function parseRateFromStored(raw) {
  if (raw == null || raw === "") return null;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_WINNINGS_TAX_RATE || parsed > MAX_WINNINGS_TAX_RATE) {
    return null;
  }
  return parsed;
}

/**
 * Effective platform tax settings for new tickets and public config.
 *
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function resolveWinningsTax(prismaClient) {
  const [enabledRow, rateRow] = await Promise.all([
    prismaClient.setting.findUnique({
      where: { key: WINNINGS_TAX_ENABLED_SETTING_KEY },
    }),
    prismaClient.setting.findUnique({
      where: { key: WINNINGS_TAX_RATE_SETTING_KEY },
    }),
  ]);

  let enabled = DEFAULT_WINNINGS_TAX_ENABLED;
  const parsedEnabled = parseEnabledFromStored(enabledRow?.value);
  if (parsedEnabled != null) enabled = parsedEnabled;

  let rate = DEFAULT_WINNINGS_TAX_RATE;
  const parsedRate = parseRateFromStored(rateRow?.value);
  if (parsedRate != null) rate = parsedRate;

  return {
    enabled,
    rate,
    configuredInDatabase: Boolean(enabledRow || rateRow),
  };
}

/**
 * Prisma create/update payload fragment for new tickets.
 *
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function snapshotWinningsTaxForNewTicket(prismaClient) {
  const { enabled, rate } = await resolveWinningsTax(prismaClient);
  const apply = Boolean(enabled && rate > 0);
  return {
    apply_winnings_tax: apply,
    winnings_tax_rate: apply ? rate : null,
  };
}

function ticketGrossWin(ticket) {
  return Number(ticket?.potential_win ?? ticket?.potentialWin ?? 0);
}

function ticketTaxRate(ticket) {
  return ticket?.winnings_tax_rate != null
    ? Number(ticket.winnings_tax_rate)
    : ticket?.winningsTaxRate != null
      ? Number(ticket.winningsTaxRate)
      : null;
}

function ticketApplyFlag(ticket) {
  return Boolean(
    ticket?.apply_winnings_tax ?? ticket?.applyWinningsTax,
  );
}

/**
 * Applied withholding: only WON / PAID, from the settled winning amount.
 *
 * @param {import("@prisma/client").Ticket | object} ticket
 */
export function ticketWinningsTaxBreakdown(ticket) {
  const gross = ticketGrossWin(ticket);
  const apply =
    ticketApplyFlag(ticket) && isWinningsTaxAppliedStatus(ticket?.status);
  return computeWinningsTaxBreakdown(gross, apply, ticketTaxRate(ticket));
}

/**
 * Estimated tax on the winning / possible-win amount. Used for helper text
 * on open tickets. Lost / void / canceled tickets return zero.
 *
 * @param {import("@prisma/client").Ticket | object} ticket
 */
export function estimateWinningsTaxBreakdown(ticket) {
  const status = ticketStatusUpper(ticket);
  const blocked = Boolean(status) && !WINNINGS_TAX_ESTIMATE_STATUSES.has(status);
  const apply = ticketApplyFlag(ticket) && !blocked;
  return computeWinningsTaxBreakdown(
    ticketGrossWin(ticket),
    apply,
    ticketTaxRate(ticket),
  );
}

/**
 * Fields to spread into ticket API payloads.
 *
 * @param {import("@prisma/client").Ticket | object} ticket
 */
export function ticketWinningsTaxApiFields(ticket) {
  const applied = ticketWinningsTaxBreakdown(ticket);
  const estimated = estimateWinningsTaxBreakdown(ticket);
  const rate = ticketTaxRate(ticket);
  return {
    applyWinningsTax: ticketApplyFlag(ticket),
    winningsTaxRate: rate,
    winningsTaxAmount: applied.taxAmount,
    estimatedWinningsTaxAmount: estimated.taxAmount,
    netPayout: applied.netPayout,
    winningsTaxHelper: formatWinningsTaxHelperText(rate, estimated.taxAmount),
  };
}
