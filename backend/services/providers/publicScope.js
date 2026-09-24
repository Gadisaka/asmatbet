/**
 * Dual-provider isolation. OddsPapi rows live in the same collections as
 * API-Football with `provider: "oddspapi"`. Which set the public API serves
 * is selected by `SPORTS_PROVIDER` (`apifootball` | `oddspapi`).
 *
 * Legacy API-Football documents have no `provider` field. Mongo `$ne`
 * matches missing fields, so `{ provider: { not: "oddspapi" } }` keeps them.
 */

export const PROVIDER_APIFOOTBALL = "apifootball";
export const PROVIDER_ODDSPAPI = "oddspapi";

function activeProvider() {
  const raw = String(process.env.SPORTS_PROVIDER || PROVIDER_APIFOOTBALL)
    .trim()
    .toLowerCase();
  return raw === PROVIDER_ODDSPAPI ? PROVIDER_ODDSPAPI : PROVIDER_APIFOOTBALL;
}

/**
 * Prisma `where` fragment for customer-facing fixture queries.
 * Kept under the original name so the public route call sites stay unchanged.
 */
export function notOddspapiWhere() {
  if (activeProvider() === PROVIDER_ODDSPAPI) {
    return { provider: PROVIDER_ODDSPAPI };
  }
  return { provider: { not: PROVIDER_ODDSPAPI } };
}

export function andNotOddspapi(where = {}) {
  return { AND: [where, notOddspapiWhere()] };
}

/** True when this row must not be served on the public book. */
export function isOddspapiRow(row) {
  if (activeProvider() === PROVIDER_ODDSPAPI) {
    return row?.provider !== PROVIDER_ODDSPAPI;
  }
  return row?.provider === PROVIDER_ODDSPAPI;
}

export function isPublicProviderRow(row) {
  return !isOddspapiRow(row);
}
