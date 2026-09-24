/**
 * OddsPapi WebSocket messages are deltas: only changed bookmakers / markets /
 * outcomes are present. Replacing the cached tree would wipe the rest of the
 * book (or a later "fixturePath only" patch would empty `markets`).
 */
export function mergeBookmakerOdds(prev, patch) {
  if (!patch || typeof patch !== "object") return prev && typeof prev === "object" ? prev : {};
  const out = { ...(prev && typeof prev === "object" ? prev : {}) };
  for (const [slug, book] of Object.entries(patch)) {
    if (!book || typeof book !== "object") continue;
    const prevBook = out[slug] && typeof out[slug] === "object" ? out[slug] : {};
    const nextBook = { ...prevBook, ...book };
    if (book.markets && typeof book.markets === "object") {
      const markets = { ...(prevBook.markets || {}) };
      for (const [mid, market] of Object.entries(book.markets)) {
        if (!market || typeof market !== "object") continue;
        const prevMarket = markets[mid] && typeof markets[mid] === "object" ? markets[mid] : {};
        const nextMarket = { ...prevMarket, ...market };
        if (market.outcomes && typeof market.outcomes === "object") {
          const outcomes = { ...(prevMarket.outcomes || {}) };
          for (const [oid, outcome] of Object.entries(market.outcomes)) {
            if (!outcome || typeof outcome !== "object") continue;
            const prevOutcome =
              outcomes[oid] && typeof outcomes[oid] === "object" ? outcomes[oid] : {};
            const nextOutcome = { ...prevOutcome, ...outcome };
            if (outcome.players && typeof outcome.players === "object") {
              const players = { ...(prevOutcome.players || {}) };
              for (const [pid, player] of Object.entries(outcome.players)) {
                players[pid] = {
                  ...(players[pid] && typeof players[pid] === "object" ? players[pid] : {}),
                  ...player,
                };
              }
              nextOutcome.players = players;
            }
            outcomes[oid] = nextOutcome;
          }
          nextMarket.outcomes = outcomes;
        }
        markets[mid] = nextMarket;
      }
      nextBook.markets = markets;
    }
    out[slug] = nextBook;
  }
  return out;
}
