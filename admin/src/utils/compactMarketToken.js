const MATCH_WINNER_SIDE = { "1": "HOME", x: "DRAW", "2": "AWAY" };
const DC_COMBINATION = { "1x": "1X", x2: "X2", "12": "12" };

export function resolveCompactMarketToken(tokenId) {
  const id = String(tokenId || "").toLowerCase();
  if (id in MATCH_WINNER_SIDE) {
    return {
      marketLabel: "Match Winner",
      marketCode: "MATCH_WINNER",
      marketParams: { side: MATCH_WINNER_SIDE[id] },
      label: id.toUpperCase(),
    };
  }
  if (id in DC_COMBINATION) {
    const combination = DC_COMBINATION[id];
    return {
      marketLabel: "Double Chance",
      marketCode: "DOUBLE_CHANCE",
      marketParams: { combination },
      label: combination,
    };
  }
  return null;
}
