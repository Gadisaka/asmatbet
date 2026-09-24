/**
 * Name-based logo fallback. Sofascore's JSON API is 403 from our VPS;
 * TheSportsDB search is reachable and its badge CDN allows hotlinking.
 */

export const THESPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json";

const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_GAP_MS = 1_200;
const USER_AGENT = "asmatbet-logo-resolver/1.0";

let lastRequestAt = 0;

export function theSportsDbKey(env = process.env) {
  return env.THESPORTSDB_KEY || "123";
}

export function resetTheSportsDbPace() {
  lastRequestAt = 0;
}

function sleep(ms, sleepFn) {
  const wait = Number(ms) || 0;
  if (wait <= 0) return Promise.resolve();
  if (typeof sleepFn === "function") return sleepFn(wait);
  return new Promise((resolve) => setTimeout(resolve, wait));
}

async function pace({ now = Date.now(), sleepFn } = {}) {
  const wait = lastRequestAt + MIN_GAP_MS - now;
  if (wait > 0) await sleep(wait, sleepFn);
  lastRequestAt = Date.now();
}

export function foldName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|fk|afc|bk|if|sk|ac)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchQueries(name) {
  const raw = String(name || "").trim();
  if (!raw) return [];
  const stripped = raw
    .replace(/\b(FC|CF|AFC|SC|FK|SK|AC|AS)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([raw, stripped].filter(Boolean))];
}

export function leagueNameScore(query, candidate) {
  const a = foldName(query);
  const b = foldName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 80;
  const ta = new Set(a.split(" ").filter((t) => t.length > 2));
  const tb = new Set(b.split(" ").filter((t) => t.length > 2));
  const inter = [...ta].filter((t) => tb.has(t));
  if (inter.length >= 2) return 60;
  if (inter.length === 1) return 25;
  return 0;
}

export function pickSoccerTeam(teams, query) {
  const q = foldName(query);
  if (!q || !Array.isArray(teams)) return null;
  let best = null;
  let bestScore = 0;
  for (const team of teams) {
    if (String(team?.strSport || "").toLowerCase() !== "soccer") continue;
    const names = [team.strTeam, team.strTeamAlternate, team.strTeamShort];
    let score = 0;
    for (const name of names) {
      if (!name) continue;
      for (const part of String(name).split(",")) {
        score = Math.max(score, leagueNameScore(q, part));
      }
    }
    if (score > bestScore) {
      best = team;
      bestScore = score;
    }
  }
  return bestScore >= 60 ? best : null;
}

export function leaguesFromTeam(team) {
  if (!team) return [];
  const out = [];
  for (let i = 1; i <= 7; i += 1) {
    const suffix = i === 1 ? "" : String(i);
    const id = Number(team[`idLeague${suffix}`]);
    const name = team[`strLeague${suffix}`];
    if (Number.isFinite(id) && id > 0 && name) out.push({ id, name });
  }
  return out;
}

export function pickLeagueFromTeam(team, leagueName) {
  const rows = leaguesFromTeam(team);
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const score = leagueNameScore(leagueName, row.name);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 60 ? best : null;
}

export function teamBadgeUrl(team) {
  return team?.strBadge || team?.strTeamBadge || team?.strLogo || null;
}

export function leagueBadgeUrl(league) {
  return league?.strBadge || league?.strLogo || null;
}

async function getJson(
  path,
  { fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, sleepFn, key } = {},
) {
  await pace({ sleepFn });
  const url = `${THESPORTSDB_BASE}/${key || theSportsDbKey()}${path}`;
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      const err = new Error(`thesportsdb ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchTeam(name, opts = {}) {
  const queries = searchQueries(name);
  for (const q of queries) {
    const data = await getJson(`/searchteams.php?t=${encodeURIComponent(q)}`, opts);
    const team = pickSoccerTeam(data?.teams || [], name);
    if (team) return team;
  }
  return null;
}

export async function lookupLeague(leagueId, opts = {}) {
  const id = Number(leagueId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const data = await getJson(`/lookupleague.php?id=${id}`, opts);
  return (data?.leagues || [])[0] || null;
}
