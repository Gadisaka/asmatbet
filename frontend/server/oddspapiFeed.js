import { flattenOdds } from "../../backend/services/providers/oddspapi/normalize.js";
import { legacyMarketsFromLines } from "../../backend/services/providers/oddspapi/marketBridge.js";
import { flagUrlForCategory } from "../../backend/services/providers/oddspapi/countryFlag.js";

const BASE_URL = "https://api.oddspapi.io";
const SPORT_ID = 10;
const BOOKMAKER = "pinnacle+30";
const WINDOW_DAYS = 3;
const CACHE_MS = 2 * 60 * 1000;
const BATCH_SIZE = 5;
const ODDS_BATCH_LIMIT = 2;
const ODDS_RETRY_MS = 60_000;

const SUMMARY_MARKETS = new Set([
  "Match Winner",
  "Double Chance",
  "Both Teams Score",
  "Goals Over/Under",
  "First Half Winner",
]);

const STATUS_BY_ID = {
  0: "NS",
  1: "LIVE",
  2: "FT",
  3: "CANC",
};

let apiKey = "";
let windowCache = null;
let windowExpires = 0;
let windowInflight = null;
let marketMap = null;
const oddsByFixtureId = new Map();
const pricedTournaments = new Set();
const coolingTournaments = new Map();

export function configureOddspapiFeed(key) {
  apiKey = String(key || "").trim();
}

export function hasOddspapiKey() {
  return Boolean(apiKey);
}

function asList(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (body.fixtureId) return [body];
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.fixtures)) return body.fixtures;
    const values = Object.values(body);
    if (
      values.length &&
      values.every((value) => value && typeof value === "object" && value.fixtureId)
    ) {
      return values;
    }
  }
  return [];
}

function utcDayStart(offset) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + offset);
  return start;
}

function ymd(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function oddspapi(path, params) {
  const qs = new URLSearchParams();
  qs.set("apiKey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    qs.set(key, String(value));
  }
  const res = await fetch(`${BASE_URL}${path}?${qs.toString()}`);
  if (!res.ok) {
    const err = new Error(`OddsPapi ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadMarketMap() {
  if (marketMap) return marketMap;
  const rows = asList(await oddspapi("/v4/markets", { language: "en" }));
  const map = {};
  for (const row of rows) {
    if (row.sportId != null && Number(row.sportId) !== SPORT_ID) continue;
    const outcomes = {};
    for (const outcome of row.outcomes || []) {
      outcomes[String(outcome.outcomeId)] = outcome.outcomeName;
    }
    map[String(row.marketId)] = {
      marketName: row.marketName,
      marketType: row.marketType,
      period: row.period,
      handicap: row.handicap,
      playerProp: Boolean(row.playerProp),
      outcomes,
    };
  }
  marketMap = map;
  return map;
}

function bookmakerSlug(raw) {
  const books = raw?.bookmakerOdds || {};
  if (books[BOOKMAKER]) return BOOKMAKER;
  return Object.keys(books)[0] || BOOKMAKER;
}

function rememberOdds(raw, catalogue) {
  if (!raw?.fixtureId) return;
  const flat = flattenOdds(raw, bookmakerSlug(raw));
  const markets = legacyMarketsFromLines(flat.lines, catalogue, {
    bookSuspended: flat.suspended,
  }).map((market) => ({
    name: market.name,
    odd_lines: (market.odd_lines || [])
      .filter((line) => line.active !== false && line.suspended !== true)
      .map((line) => ({
        value: line.value,
        odd: line.odd,
      })),
  })).filter((market) => market.odd_lines.length > 0);
  oddsByFixtureId.set(String(raw.fixtureId), markets);
}

function tournamentReady(id) {
  const key = String(id);
  if (pricedTournaments.has(key)) return false;
  const coolUntil = coolingTournaments.get(key) || 0;
  return coolUntil <= Date.now();
}

function coolBatch(batch, ms = ODDS_RETRY_MS) {
  const until = Date.now() + ms;
  for (const id of batch) coolingTournaments.set(String(id), until);
}

async function ensureOdds(fixtures, { limitBatches = ODDS_BATCH_LIMIT } = {}) {
  const catalogue = await loadMarketMap();
  const missing = [
    ...new Set(
      fixtures
        .filter((fixture) => fixture.hasOdds !== false)
        .map((fixture) => fixture.tournamentId)
        .filter((id) => id != null && tournamentReady(id)),
    ),
  ];
  if (!missing.length) return;

  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batches.push(missing.slice(i, i + BATCH_SIZE));
  }
  const work = batches.slice(0, Math.max(1, limitBatches));

  for (const batch of work) {
    try {
      const body = await oddspapi("/v4/odds-by-tournaments", {
        tournamentIds: batch.join(","),
        bookmakers: BOOKMAKER,
        verbosity: 3,
      });
      for (const raw of asList(body)) rememberOdds(raw, catalogue);
      for (const id of batch) pricedTournaments.add(String(id));
    } catch (err) {
      coolBatch(batch, err.status === 429 ? ODDS_RETRY_MS : 15_000);
      console.error("[oddspapi] odds batch failed:", err.message);
      if (err.status === 429) break;
    }
  }
}

async function fetchFixtureOdds(raw) {
  if (!raw?.fixtureId || oddsByFixtureId.has(String(raw.fixtureId))) return;
  const catalogue = await loadMarketMap();
  const body = await oddspapi("/v4/odds", {
    fixtureId: raw.fixtureId,
    bookmakers: BOOKMAKER,
    verbosity: 3,
  });
  const rows = asList(body);
  if (rows.length) {
    for (const row of rows) rememberOdds(row, catalogue);
  } else {
    rememberOdds(body, catalogue);
  }
}

async function loadWindow() {
  if (windowCache && windowExpires > Date.now()) return windowCache;
  if (windowInflight) return windowInflight;

  windowInflight = (async () => {
    const from = utcDayStart(0);
    const to = utcDayStart(WINDOW_DAYS);
    const fixtures = asList(
      await oddspapi("/v4/fixtures", {
        sportId: SPORT_ID,
        from: from.toISOString(),
        to: to.toISOString(),
      }),
    );
    windowCache = fixtures;
    windowExpires = Date.now() + CACHE_MS;
    return fixtures;
  })().finally(() => {
    windowInflight = null;
  });

  return windowInflight;
}

function statusOf(raw) {
  return STATUS_BY_ID[Number(raw?.statusId)] || "NS";
}

export function toPublicFixture(raw) {
  const status = statusOf(raw);
  const markets = oddsByFixtureId.get(String(raw.fixtureId)) || [];
  const cells = markets.reduce(
    (sum, market) => sum + (market.odd_lines?.length || 0),
    0,
  );
  const country = raw.categoryName || "International";
  const apiFixtureId = Number(String(raw.fixtureId || "").replace(/^id/i, ""));
  return {
    api_fixture_id: Number.isSafeInteger(apiFixtureId) ? apiFixtureId : raw.fixtureId,
    start_time: new Date(raw.startTime || raw.trueStartTime).toISOString(),
    status,
    home_score: raw.participant1Score ?? null,
    away_score: raw.participant2Score ?? null,
    elapsed: raw.elapsed ?? raw.minute ?? null,
    live_status: status === "LIVE" ? "LIVE" : null,
    available_odd_cells_count: cells,
    sport: { name: "Football" },
    home_team: { name: raw.participant1Name || "Home", logo: null },
    away_team: { name: raw.participant2Name || "Away", logo: null },
    league: {
      name: raw.tournamentName || "League",
      country,
      country_flag: flagUrlForCategory(raw.categorySlug),
      logo: null,
      api_league_id: raw.tournamentId ?? null,
      rank: 9999,
      sport: { name: "Football" },
    },
    markets: markets.filter((market) => SUMMARY_MARKETS.has(market.name)),
    _allMarkets: markets,
  };
}

function stripInternal(fixture) {
  const { _allMarkets, ...publicFixture } = fixture;
  return publicFixture;
}

export async function fixturesForUtcDate(dateYmd) {
  const fixtures = await loadWindow();
  const day = fixtures.filter((fixture) => {
    const kickoff = fixture.startTime || fixture.trueStartTime;
    return kickoff && ymd(kickoff) === dateYmd && statusOf(fixture) === "NS";
  });
  await ensureOdds(day);
  return day.map((fixture) => stripInternal(toPublicFixture(fixture)));
}

export async function liveFixtures() {
  const fixtures = await loadWindow();
  const live = fixtures.filter((fixture) => statusOf(fixture) === "LIVE");
  await ensureOdds(live);
  return live.map((fixture) => stripInternal(toPublicFixture(fixture)));
}

export async function oddsForFixture(apiFixtureId) {
  const id = String(apiFixtureId);
  const fixtures = windowCache || [];
  const raw = fixtures.find((fixture) => {
    const numeric = String(fixture.fixtureId || "").replace(/^id/i, "");
    return numeric === id || String(fixture.fixtureId) === id;
  });
  if (raw && !oddsByFixtureId.has(String(raw.fixtureId))) {
    try {
      await fetchFixtureOdds(raw);
    } catch (err) {
      console.error("[oddspapi] fixture odds failed:", err.message);
    }
  }
  const markets =
    (raw && oddsByFixtureId.get(String(raw.fixtureId))) ||
    [...oddsByFixtureId.entries()].find(([fixtureId]) =>
      fixtureId.replace(/^id/i, "") === id,
    )?.[1] ||
    [];
  return { markets };
}

export async function sidebarLeagues() {
  const fixtures = await loadWindow();
  const counts = new Map();
  for (const fixture of fixtures) {
    if (statusOf(fixture) !== "NS") continue;
    const country = fixture.categoryName || "International";
    const name = fixture.tournamentName || "League";
    const id = `${country} - ${name}`;
    const prev = counts.get(id) || {
      id,
      label: name,
      country,
      countryFlag: flagUrlForCategory(fixture.categorySlug),
      leagueLogo: null,
      rank: 9999,
      section: "regional",
      count: 0,
    };
    prev.count += 1;
    counts.set(id, prev);
  }
  const items = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
  return { horizonDays: WINDOW_DAYS, items };
}
