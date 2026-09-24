/**
 * Unofficial Sofascore HTTP client used only to resolve league/club image
 * URLs from a fixture's `external_ids.sofascoreId`.
 *
 * Paced at ~1 req/s. Kill switch lives on the caller (`SOFASCORE_LOGOS_ENABLED`).
 */

export const SOFASCORE_API = "https://api.sofascore.com/api/v1";
export const SOFASCORE_IMG = "https://img.sofascore.com/api/v1";

const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_GAP_MS = 1_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let lastRequestAt = 0;

export function sleep(ms, sleepFn) {
  const wait = Number(ms) || 0;
  if (wait <= 0) return Promise.resolve();
  if (typeof sleepFn === "function") return sleepFn(wait);
  return new Promise((resolve) => setTimeout(resolve, wait));
}

export async function paceRequests({ now = Date.now(), gapMs = MIN_GAP_MS, sleepFn } = {}) {
  const wait = lastRequestAt + gapMs - now;
  if (wait > 0) await sleep(wait, sleepFn);
  lastRequestAt = Date.now();
}

/** Test helper — reset the in-process rate limiter. */
export function resetSofascorePace() {
  lastRequestAt = 0;
}

export function teamImageUrl(teamId) {
  const id = Number(teamId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `${SOFASCORE_IMG}/team/${id}/image`;
}

export function uniqueTournamentImageUrl(tournamentId) {
  const id = Number(tournamentId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `${SOFASCORE_IMG}/unique-tournament/${id}/image`;
}

const PUBLIC_LOGO_KINDS = new Set(["team", "unique-tournament"]);

/** Same-origin path — img.sofascore.com 403s requests that send our Referer. */
export function publicLogoPath(kind, id) {
  if (!PUBLIC_LOGO_KINDS.has(kind)) return null;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `/api/football/logo/${kind}/${n}`;
}

export function upstreamImageUrl(kind, id) {
  if (kind === "team") return teamImageUrl(id);
  if (kind === "unique-tournament") return uniqueTournamentImageUrl(id);
  return null;
}

export function parseLogoKind(kind) {
  const key = String(kind || "").trim();
  return PUBLIC_LOGO_KINDS.has(key) ? key : null;
}

export async function fetchImage(
  kind,
  id,
  { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, sleepFn, pace = false } = {},
) {
  const parsedKind = parseLogoKind(kind);
  const url = upstreamImageUrl(parsedKind, id);
  if (!url) {
    const err = new Error("invalid sofascore image");
    err.status = 400;
    throw err;
  }
  if (pace) await paceRequests({ sleepFn });
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": USER_AGENT,
      },
    });
    if (!res.ok) {
      const err = new Error(`sofascore image ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    return { contentType, buf };
  } finally {
    clearTimeout(timer);
  }
}

export function unwrapEvent(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.event && typeof payload.event === "object" ? payload.event : payload;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Pull Sofascore team / unique-tournament ids and the hotlink image URLs
 * from a `/event/:id` payload.
 */
export function parseEventLogos(payload) {
  const event = unwrapEvent(payload);
  if (!event) return null;
  const homeTeamId = positiveInt(event.homeTeam?.id);
  const awayTeamId = positiveInt(event.awayTeam?.id);
  const uniqueTournamentId = positiveInt(
    event.tournament?.uniqueTournament?.id ?? event.uniqueTournament?.id,
  );
  if (!homeTeamId && !awayTeamId && !uniqueTournamentId) return null;
  return {
    homeTeamId,
    awayTeamId,
    uniqueTournamentId,
    homeLogo: teamImageUrl(homeTeamId),
    awayLogo: teamImageUrl(awayTeamId),
    leagueLogo: uniqueTournamentImageUrl(uniqueTournamentId),
  };
}

export async function fetchEvent(
  eventId,
  { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, sleepFn } = {},
) {
  const id = positiveInt(eventId);
  if (!id) {
    const err = new Error("invalid sofascore event id");
    err.status = 400;
    throw err;
  }
  await paceRequests({ sleepFn });
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchFn(`${SOFASCORE_API}/event/${id}`, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Origin: "https://www.sofascore.com",
        Referer: "https://www.sofascore.com/",
      },
    });
    if (!res.ok) {
      const err = new Error(`sofascore ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
