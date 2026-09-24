import prisma from "../Config/db.js";
import { isProviderMarketNameAllowed, isOddspapiMarketOfferable } from "./markets/marketSupport.js";
import { PROVIDER_ODDSPAPI } from "./providers/publicScope.js";

/** Matches list summary + frontend `MAIN_MARKET_NAMES` (non–“extra” markets). */
export const EXTRA_MARKETS_SUMMARY_NAMES = ["Match Winner", "Double Chance"];

const SUMMARY_NAME_SET = new Set(
  EXTRA_MARKETS_SUMMARY_NAMES.map((n) => n.toLowerCase()),
);

function normalizeSelectionLabel(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["home", "1"].includes(raw)) return "1";
  if (["draw", "x"].includes(raw)) return "x";
  if (["away", "2"].includes(raw)) return "2";
  if (["1x", "home/draw", "home or draw"].includes(raw)) return "1x";
  if (["12", "home/away", "home or away"].includes(raw)) return "12";
  if (["x2", "draw/away", "draw or away"].includes(raw)) return "x2";
  return String(value || "").trim();
}

function countOddCellsInMarket(oddLines = []) {
  const seen = new Set();
  let count = 0;
  for (const line of oddLines) {
    const id = normalizeSelectionLabel(line?.value);
    const odd = Number.parseFloat(line?.odd);
    if (!id || !Number.isFinite(odd)) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

function isSummaryMarketName(name) {
  return SUMMARY_NAME_SET.has(String(name || "").trim().toLowerCase());
}

/**
 * Load markets with lines and keep only those the public book may serve.
 */
async function loadAllowlistedMarketsWithLines(fixtureId) {
  const [fixture, markets] = await Promise.all([
    prisma.fixture.findUnique({
      where: { id: fixtureId },
      select: { provider: true },
    }),
    prisma.fixtureMarket.findMany({
      where: {
        fixture_id: fixtureId,
        odd_lines: { some: {} },
      },
      include: { odd_lines: true },
    }),
  ]);

  const oddspapi = fixture?.provider === PROVIDER_ODDSPAPI;
  return markets.filter((market) =>
    oddspapi
      ? isOddspapiMarketOfferable(market)
      : isProviderMarketNameAllowed(market?.name),
  );
}

/**
 * Count of fixture markets other than MW/DC that have at least one odd line
 * and are allowlisted for public odds. Updated whenever odds rows change.
 */
export async function recomputeExtraMarketsCountForFixture(fixtureId) {
  const markets = await loadAllowlistedMarketsWithLines(fixtureId);

  const oddCells = markets.reduce(
    (sum, market) => sum + countOddCellsInMarket(market.odd_lines),
    0,
  );
  const extraMarkets = markets.filter(
    (market) => !isSummaryMarketName(market.name),
  ).length;

  await prisma.fixture.update({
    where: { id: fixtureId },
    data: {
      extra_markets_count: extraMarkets,
      available_odd_cells_count: oddCells,
    },
  });
  return extraMarkets;
}
