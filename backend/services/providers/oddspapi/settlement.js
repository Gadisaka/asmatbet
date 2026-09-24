/**
 * OddsPapi `/v4/settlements` normalisation.
 *
 * The provider returns a nested tree keyed by string ids:
 *
 *   markets[marketId].outcomes[outcomeId].players[playerId].result
 *
 * A finished fixture carries a verdict for the entire 1,122-row market
 * catalogue, not just the markets a bookmaker priced. The overwhelming
 * majority are `UNDECIDED` and must never drive retries — see §6.3 of the
 * migration plan.
 */

/** Raw provider verdicts, per the API docs. */
export const PROVIDER_RESULTS = Object.freeze([
  "WIN",
  "LOSE",
  "HALFWIN",
  "HALFLOSS",
  "PUSH",
  "CANCELLED",
  "UNDECIDED",
]);

/**
 * Provider verdict -> our ticket model.
 *
 * `factor` is the fraction of the stake that participates in the result. It
 * exists because quarter-line Asian handicaps settle at half stake, which our
 * WON/LOST/VOID enum cannot express on its own (§6.2).
 */
const RESULT_MAP = new Map([
  ["WIN", { result: "WON", factor: 1 }],
  ["LOSE", { result: "LOST", factor: 1 }],
  ["HALFWIN", { result: "WON", factor: 0.5 }],
  ["HALFLOSS", { result: "LOST", factor: 0.5 }],
  ["PUSH", { result: "VOID", factor: 0 }],
  ["CANCELLED", { result: "VOID", factor: 0 }],
  ["UNDECIDED", { result: "PENDING", factor: 0 }],
]);

export function outcomeKey(marketId, outcomeId, playerId = 0) {
  return `${Number(marketId)}:${Number(outcomeId)}:${Number(playerId)}`;
}

/**
 * Translate a raw provider verdict into `{ result, factor }`.
 * Unknown verdicts stay PENDING rather than guessing a payout.
 */
export function toTicketResult(providerResult) {
  const key = String(providerResult || "").trim().toUpperCase();
  const mapped = RESULT_MAP.get(key);
  if (!mapped) return { result: "PENDING", factor: 0, unknown: true };
  return { ...mapped };
}

/**
 * Flatten a settlements response into a lookup keyed by
 * `marketId:outcomeId:playerId`.
 *
 * @param {object} raw settlements payload
 * @param {{ includeUndecided?: boolean }} [opts]
 * @returns {{ fixtureId: string|null, byKey: Map<string, object>, counts: object }}
 */
export function normalizeSettlements(raw, opts = {}) {
  const includeUndecided = opts.includeUndecided === true;
  const byKey = new Map();
  const counts = Object.create(null);

  const markets = raw?.markets;
  if (markets && typeof markets === "object") {
    for (const [marketId, market] of Object.entries(markets)) {
      const outcomes = market?.outcomes;
      if (!outcomes || typeof outcomes !== "object") continue;

      for (const [outcomeId, outcome] of Object.entries(outcomes)) {
        const players = outcome?.players;
        if (!players || typeof players !== "object") continue;

        for (const [playerId, player] of Object.entries(players)) {
          const providerResult = String(player?.result || "").toUpperCase();
          if (!providerResult) continue;
          counts[providerResult] = (counts[providerResult] || 0) + 1;
          if (providerResult === "UNDECIDED" && !includeUndecided) continue;

          const key = outcomeKey(marketId, outcomeId, playerId);
          byKey.set(key, {
            marketId: Number(marketId),
            outcomeId: Number(outcomeId),
            playerId: Number(playerId),
            providerResult,
            ...toTicketResult(providerResult),
          });
        }
      }
    }
  }

  return { fixtureId: raw?.fixtureId ?? null, byKey, counts };
}

/** True when the provider has graded nothing yet — the retry signal. */
export function isFullyUndecided(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return true;
  return (counts.UNDECIDED || 0) === total;
}

/**
 * Resolve a ticket leg against a flattened settlements map.
 * HALFWIN/HALFLOSS return factor 0.5; payout math lives in `legPayoutMultiplier`.
 */
export function lookupTicketResult(byKey, marketId, outcomeId, playerId = 0) {
  if (marketId == null || outcomeId == null || !byKey) {
    return {
      result: "PENDING",
      reason: "missing_provider_ids",
      factor: 0,
    };
  }
  const entry = byKey.get(outcomeKey(marketId, outcomeId, playerId));
  if (!entry) {
    return {
      result: "PENDING",
      reason: "settlement_undecided",
      factor: 0,
    };
  }
  return {
    result: entry.result,
    reason: `oddspapi:${entry.providerResult}`,
    factor: entry.factor,
    providerResult: entry.providerResult,
    engineVersion: 0,
    marketVersion: 0,
  };
}
