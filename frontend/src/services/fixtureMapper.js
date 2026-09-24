import { SPORTSBOOK_TIMEZONE } from "../utils/sportsbookDay.js";

function formatDateForUi(isoDate) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";

  const datePart = d.toLocaleDateString("en-GB", {
    timeZone: SPORTSBOOK_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: SPORTSBOOK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart} ${d.toLocaleDateString("en-GB", { timeZone: SPORTSBOOK_TIMEZONE, year: "numeric" })}`;
}

function toUiOdd(value) {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return null;
  return n.toFixed(2);
}

/**
 * Atomic side aliases only. Do NOT collapse compounds like Home/Draw → 1x here:
 * those mean Double Chance in one market and HT/FT in another.
 */
function normalizeSelectionLabel(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["home", "1"].includes(raw)) return "1";
  if (["draw", "x"].includes(raw)) return "x";
  if (["away", "2"].includes(raw)) return "2";
  // Over/Under, HT/FT, Asian Handicap, Correct Score, explicit 1x/12/x2, …
  return String(value || "").trim();
}

/** Map a Double Chance selection id to the compact summary strip key. */
function toDoubleChanceSummaryKey(id) {
  const raw = String(id || "")
    .trim()
    .toLowerCase();
  if (["1x", "home/draw", "home or draw", "x1"].includes(raw)) return "1x";
  if (["12", "home/away", "home or away", "21"].includes(raw)) return "12";
  if (["x2", "draw/away", "draw or away", "2x"].includes(raw)) return "x2";
  return null;
}

function toCategoryOdds(lines = []) {
  const seen = new Set();
  const out = [];

  for (const line of lines) {
    const id = normalizeSelectionLabel(line.value);
    const value = toUiOdd(line.odd);
    if (!value || !id) continue;
    // Multiple bookmakers may price the same value for the same market.
    // When no preferred bookmaker is set server-side the line list can be
    // huge — dedupe by label so the UI doesn't render stacks of the same
    // button.
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, value });
  }

  return out;
}

/** Count priced selection cells across all markets (matches expansion UI). */
export function countOddCellsFromMarkets(markets = []) {
  let total = 0;
  for (const market of markets) {
    total += toCategoryOdds(market.odd_lines || []).length;
  }
  return total;
}

export function countOddCellsFromDetailedOdds(detailedOdds) {
  if (!detailedOdds) return 0;
  const categories = [
    ...(detailedOdds.main || []),
    ...(detailedOdds.extra || []),
  ];
  return categories.reduce((sum, cat) => sum + (cat.odds?.length || 0), 0);
}

// Categories we consider "main" — they feed the compact summary row
// (1 / X / 2 / 1X / X2 / 12) shown on every match card.
const MAIN_MARKET_NAMES = new Set(["Match Winner", "Double Chance"]);

function toDetailedOdds(markets = []) {
  const normalized = markets
    .map((market) => ({
      category: market.name,
      odds: toCategoryOdds(market.odd_lines),
    }))
    .filter((m) => m.odds.length > 0);

  const main = normalized.filter((m) => MAIN_MARKET_NAMES.has(m.category));
  const extra = normalized.filter((m) => !MAIN_MARKET_NAMES.has(m.category));
  return { main, extra };
}

/**
 * Raw fixtures may arrive as either:
 * - **Summary lists** (`GET /fixtures?date=`): Match Winner + Double Chance only,
 *   capped odd_lines — enough for the collapsed row (`markets`, compact `detailedOdds.main`).
 * - **Detail** (`GET /odds/:id`): merged via `applyOddsToMatch` into `detailedOdds`
 *   only; the six-cell `markets` strip stays from the list payload so
 *   prices do not jump when the row expands. `sideBets` stays at list-time.
 *
 * `sideBets` is the badge on the row — total priced odd cells across all markets
 * (deduped per market the same way as the expansion panel), not market count.
 *
 * `toSummaryMarkets` builds the compact strip using `toCategoryOdds` per market
 * (first priced line wins per selection label).
 */
function toSummaryMarkets(markets = []) {
  const map = {};

  for (const market of markets) {
    const name = String(market.name || "").toLowerCase();
    if (!name.includes("match winner") && !name.includes("double chance"))
      continue;

    const lines = toCategoryOdds(market.odd_lines || []);

    for (const { id, value } of lines) {
      const key = String(id).toLowerCase();
      if (name.includes("match winner") && ["1", "x", "2"].includes(key)) {
        map[key] = value;
      }
      if (name.includes("double chance")) {
        const dcKey = toDoubleChanceSummaryKey(id);
        if (dcKey) map[dcKey] = value;
      }
    }
  }

  return ["1", "x", "2", "1x", "x2", "12"].map((id) => ({
    id,
    value: map[id] || null,
  }));
}

function leagueSportName(league) {
  const s = league?.sport;
  if (s && typeof s === "object") return s.name || s.slug || "Football";
  if (typeof s === "string") return s;
  return "Football";
}

export function mapFixtureToMatch(fixture, oddsPayload = null) {
  const home = fixture?.home_team?.name || "Home";
  const away = fixture?.away_team?.name || "Away";
  const leagueName = fixture?.league?.name || "Unknown League";
  const country = fixture?.league?.country || "Unknown";
  const countryFlag = fixture?.league?.country_flag || null;
  const leagueLogo = fixture?.league?.logo || null;
  const homeTeamLogo = fixture?.home_team?.logo || null;
  const awayTeamLogo = fixture?.away_team?.logo || null;
  const rawSportName =
    fixture?.sport?.name ||
    fixture?.sport_name ||
    leagueSportName(fixture?.league) ||
    "Football";
  const sportName = String(rawSportName || "Football");
  const sportId = sportName.trim().toLowerCase().replace(/\s+/g, "-");

  const markets = oddsPayload?.markets || fixture?.markets || [];
  const detailedOdds = toDetailedOdds(markets);

  const fromMarkets = countOddCellsFromMarkets(markets);
  const storedCells = Number(fixture?.available_odd_cells_count);
  const sideBets =
    Number.isFinite(storedCells) && storedCells > fromMarkets
      ? storedCells
      : fromMarkets;

  const kickoffAt = fixture?.start_time
    ? new Date(fixture.start_time).toISOString()
    : null;

  return {
    id: `fx-${fixture.api_fixture_id}`,
    apiFixtureId: fixture.api_fixture_id,
    apiLeagueId: fixture?.league?.api_league_id ?? null,
    leagueRank: Number.isFinite(Number(fixture?.league?.rank))
      ? Number(fixture.league.rank)
      : 9999,
    league: `${country} - ${leagueName}`,
    match: `${home} V ${away}`,
    homeTeam: home,
    awayTeam: away,
    date: formatDateForUi(fixture.start_time),
    kickoffAt,
    sportId,
    sportName,
    status: fixture.status,
    homeScore: fixture.home_score,
    awayScore: fixture.away_score,
    countryFlag,
    leagueLogo,
    homeTeamLogo,
    awayTeamLogo,
    markets: toSummaryMarkets(markets),
    sideBets,
    detailedOdds,
  };
}

/**
 * Merges `/odds/:id` into a list-row match. Keeps `match.markets` (1–X–2 + DC)
 * from the original list response so opening the panel does not retint those
 * cells; `detailedOdds` reflects the full detail payload.
 * `sideBets` stays at the list-time badge value so expand does not change `+N`.
 */
export function applyOddsToMatch(match, oddsPayload) {
  if (!match || !oddsPayload) return match;
  const leagueStr = String(match.league || "");
  const sep = leagueStr.indexOf(" - ");
  const country = sep === -1 ? "Unknown" : leagueStr.slice(0, sep);
  const name = sep === -1 ? leagueStr || "League" : leagueStr.slice(sep + 3);
  const [homeName = "Home", awayName = "Away"] = String(
    match.match || "",
  ).split(" V ");

  const kickoffIso = match.kickoffAt || null;

  const hydrated = mapFixtureToMatch(
    {
      api_fixture_id: match.apiFixtureId,
      start_time: kickoffIso || new Date().toISOString(),
      status: match.status,
      home_score: match.homeScore,
      away_score: match.awayScore,
      home_team: { name: homeName, logo: match.homeTeamLogo },
      away_team: { name: awayName, logo: match.awayTeamLogo },
      league: {
        name,
        country,
        country_flag: match.countryFlag,
        logo: match.leagueLogo,
        sport: match.sportName || "Football",
        api_league_id: match.apiLeagueId,
        rank: match.leagueRank,
      },
      markets: oddsPayload.markets,
    },
    oddsPayload,
  );

  return {
    ...match,
    markets: match.markets,
    sideBets: match.sideBets,
    detailedOdds: hydrated.detailedOdds,
    countryFlag: hydrated.countryFlag ?? match.countryFlag,
    leagueLogo: hydrated.leagueLogo ?? match.leagueLogo,
    homeTeamLogo: hydrated.homeTeamLogo ?? match.homeTeamLogo,
    awayTeamLogo: hydrated.awayTeamLogo ?? match.awayTeamLogo,
  };
}
