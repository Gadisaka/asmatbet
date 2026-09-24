import {
  mapStatusId,
  namespacedLeagueId,
  namespacedTeamId,
  parseProviderFixtureId,
  PROVIDER,
} from "./config.js";

export function utcDayBounds(offsetDays) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/** OddsPapi allows ≤10 days between from/to when querying by sportId. Use 9. */
export function fixtureWindows(daysAhead) {
  const windows = [];
  let offset = 0;
  const span = Math.max(1, Number(daysAhead) || 1);
  while (offset < span) {
    const size = Math.min(9, span - offset);
    windows.push({ startOffset: offset, endOffset: offset + size - 1 });
    offset += size;
  }
  return windows;
}

export function windowToRange(startOffset, endOffset) {
  const from = utcDayBounds(startOffset).start;
  const to = utcDayBounds(endOffset).end;
  return { from: from.toISOString(), to: to.toISOString(), start: from, end: to };
}

export function normalizeFixture(raw) {
  const provider_fixture_id = raw.fixtureId;
  const api_fixture_id = parseProviderFixtureId(provider_fixture_id);
  if (api_fixture_id == null) {
    throw new Error(`unparseable fixtureId: ${provider_fixture_id}`);
  }
  const p1 = Number(raw.participant1Id);
  const p2 = Number(raw.participant2Id);
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
    throw new Error(`fixture ${provider_fixture_id} missing participants`);
  }
  return {
    api_fixture_id,
    provider: PROVIDER,
    provider_fixture_id,
    provider_tournament_id: Number(raw.tournamentId),
    provider_season_id: raw.seasonId == null ? null : Number(raw.seasonId),
    external_ids: raw.externalProviders || null,
    start_time: new Date(raw.startTime || raw.trueStartTime),
    status: mapStatusId(raw.statusId),
    statusId: Number(raw.statusId),
    participant1Id: p1,
    participant2Id: p2,
    participant1Name: raw.participant1Name || `Team ${p1}`,
    participant2Name: raw.participant2Name || `Team ${p2}`,
    tournamentId: Number(raw.tournamentId),
    tournamentName: raw.tournamentName || `Tournament ${raw.tournamentId}`,
    categoryName: raw.categoryName || null,
    categorySlug: raw.categorySlug || null,
    hasOdds: Boolean(raw.hasOdds),
    home_api_team_id: namespacedTeamId(p1),
    away_api_team_id: namespacedTeamId(p2),
    api_league_id: namespacedLeagueId(raw.tournamentId),
  };
}

/**
 * Flatten 1xBet (or configured bookmaker) odds into persistable lines.
 * Player-prop rows keep `playerId` / `playerName` so unique line values
 * can include the player (`Haaland - Yes`).
 */
export function flattenOdds(raw, bookmakerSlug) {
  const book = raw?.bookmakerOdds?.[bookmakerSlug];
  if (!book?.markets) return { suspended: false, lines: [] };
  const lines = [];
  for (const [mid, market] of Object.entries(book.markets)) {
    for (const [oid, outcome] of Object.entries(market.outcomes || {})) {
      for (const [pid, player] of Object.entries(outcome.players || {})) {
        if (player?.price == null) continue;
        const changedAt = player.changedAt || player.bookmakerChangedAt || null;
        lines.push({
          marketId: Number(mid),
          outcomeId: Number(oid),
          playerId: Number(pid) || 0,
          playerName: player.playerName ? String(player.playerName).trim() : null,
          price: Number(player.price),
          value: String(player.bookmakerOutcomeId || oid),
          active:
            player.active !== false &&
            market.marketActive !== false &&
            book.suspended !== true,
          changedAt,
          mainLine: Boolean(player.mainLine),
          maxLimit: player.limit == null ? null : Number(player.limit),
        });
      }
    }
  }
  return { suspended: book.suspended === true, lines };
}

function extractPeriodsObject(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.scores?.periods && typeof raw.scores.periods === "object") {
    return raw.scores.periods;
  }
  if (raw.periods && typeof raw.periods === "object") return raw.periods;
  if (raw.scores && typeof raw.scores === "object") return raw.scores;
  return null;
}

function readScore(row) {
  if (!row || typeof row !== "object") return null;
  const home = Number(row.participant1Score ?? row.home);
  const away = Number(row.participant2Score ?? row.away);
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;
  return { home, away };
}

/**
 * `/v4/scores` and the WebSocket both return periods keyed by NAME, not index:
 * `result` (incl. overtime), `p1`, `p2`, `fulltime`. These are the same period
 * tokens the market catalogue uses.
 *
 * `fulltime` is the 90' score our graders settle on; `result` includes
 * overtime and must not be substituted for it.
 *
 * `fullTime` / `halfTime` / `result` stay `{home,away}|null` so settlement
 * callers are unchanged. `periods` adds `startedAt` for the live clock.
 *
 * @returns {{
 *   fullTime: {home,away}|null,
 *   halfTime: {home,away}|null,
 *   result: {home,away}|null,
 *   periods: Record<string, {home: number|null, away: number|null, startedAt: string|null, updatedAt: string|null}>
 * }}
 */
export function normalizeScores(raw) {
  const rawPeriods = extractPeriodsObject(raw);
  const read = (key) => readScore(rawPeriods?.[key]);
  const periods = {};
  if (rawPeriods) {
    for (const [key, row] of Object.entries(rawPeriods)) {
      if (!row || typeof row !== "object") continue;
      const score = readScore(row);
      periods[key] = {
        home: score?.home ?? null,
        away: score?.away ?? null,
        startedAt: row.startedAt || null,
        updatedAt: row.updatedAt || null,
      };
    }
  }
  return {
    fullTime: read("fulltime"),
    halfTime: read("p1"),
    result: read("result"),
    periods,
  };
}

/**
 * WebSocket score frames are deltas (often only `result`). Replacing the
 * cached tree would drop a previously-seen `p1`/`p2` and break half detection.
 * Keeps the provider's period-object shape (`participant1Score`, `startedAt`).
 */
export function mergeScorePeriods(prevScores, patchScores) {
  const prev = extractPeriodsObject(prevScores) || {};
  const patch = extractPeriodsObject(patchScores) || {};
  const periods = { ...prev };
  for (const [key, row] of Object.entries(patch)) {
    if (!row || typeof row !== "object") continue;
    periods[key] = { ...(periods[key] || {}), ...row };
  }
  return { periods };
}

/** Settlement columns: `fulltime` → home/away, `p1` → ht_*. Never uses `result`. */
export function settlementScorePatch(scored) {
  const patch = {};
  if (scored?.fullTime) {
    patch.home_score = scored.fullTime.home;
    patch.away_score = scored.fullTime.away;
  }
  if (scored?.halfTime) {
    patch.ht_home_score = scored.halfTime.home;
    patch.ht_away_score = scored.halfTime.away;
  }
  return patch;
}

export function marketStorageName(marketId, catalogueName) {
  const id = Number(marketId);
  const name = catalogueName ? String(catalogueName) : "market";
  return `${id}:${name}`;
}
