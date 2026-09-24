export const PROVIDER = "oddspapi";

export function oddspapiWsCacheKey(providerFixtureId) {
  return `oddspapi:ws:${providerFixtureId}`;
}

export function getOddspapiConfig() {
  return {
    apiKey: process.env.ODDSPAPI_API_KEY || "",
    baseUrl: process.env.ODDSPAPI_BASE_URL || "https://api.oddspapi.io",
    wsUrl: process.env.ODDSPAPI_WS_URL || "wss://api.oddspapi.io/v4/ws",
    bookmaker: process.env.ODDSPAPI_BOOKMAKER || "1xbet",
    sportId: Number(process.env.ODDSPAPI_SPORT_ID || 10),
    batchSize: Math.min(
      5,
      Math.max(1, Number(process.env.ODDSPAPI_TOURNAMENT_BATCH_SIZE || 5)),
    ),
    monthlyLimit: Number(process.env.ODDSPAPI_MONTHLY_LIMIT || 500_000),
    softCeilingRatio: Number(process.env.ODDSPAPI_SOFT_CEILING_RATIO || 0.79),
    wsEnabled: process.env.ODDSPAPI_WS_ENABLED !== "0",
  };
}

export function isOddspapiShadowEnabled() {
  const flag = process.env.ENABLE_ODDSPAPI_SHADOW;
  if (flag !== "1" && String(flag).toLowerCase() !== "true") return false;
  return Boolean(process.env.ODDSPAPI_API_KEY);
}

/** Namespaces OddsPapi tournament ids away from API-Football league ids. */
export const LEAGUE_ID_BASE = 900_000_000;
/** Namespaces OddsPapi participant ids away from API-Football team ids. */
export const TEAM_ID_BASE = 800_000_000;
/**
 * Stable Bookmaker.api_bookmaker_id for OddsPapi 1xBet lines.
 * Kept off the API-Football 1xBet id (11) so the two providers never share a row.
 */
export const ODDSPAPI_BOOKMAKER_API_ID = 910_000_001;

export function parseProviderFixtureId(fixtureId) {
  const m = /^id(\d+)$/i.exec(String(fixtureId || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

export function namespacedLeagueId(tournamentId) {
  const n = Number(tournamentId);
  if (!Number.isFinite(n)) throw new Error(`bad tournamentId: ${tournamentId}`);
  return LEAGUE_ID_BASE + n;
}

export function namespacedTeamId(participantId) {
  const n = Number(participantId);
  if (!Number.isFinite(n)) throw new Error(`bad participantId: ${participantId}`);
  return TEAM_ID_BASE + n;
}

export const STATUS_BY_ID = Object.freeze({
  0: "NS",
  1: "LIVE",
  2: "FT",
  3: "CANC",
});

export function mapStatusId(statusId) {
  return STATUS_BY_ID[Number(statusId)] || "NS";
}

export const COOLDOWN_MS = Object.freeze({
  "/v4/account": 1000,
  "/v4/sports": 1000,
  "/v4/bookmakers": 1000,
  "/v4/languages": 1000,
  "/v4/tournaments": 1000,
  "/v4/fixtures": 2000,
  "/v4/fixture": 500,
  "/v4/markets": 1000,
  "/v4/participants": 1000,
  "/v4/odds": 500,
  "/v4/odds-by-tournaments": 1000,
  "/v4/historical-odds": 5000,
  "/v4/settlements": 2000,
  "/v4/scores": 1000,
});

export const FREE_PATHS = new Set(["/v4/account", "/v4/historical-odds"]);
