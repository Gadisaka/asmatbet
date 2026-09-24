import prismaDefault from "../../Config/db.js";
import { deleteByPattern as deleteByPatternDefault } from "../../services/cacheService.js";
import { PROVIDER } from "../../services/providers/oddspapi/config.js";
import { getFixturesDaysAhead } from "../../Config/ingestionConfig.js";
import {
  fetchEvent as fetchEventDefault,
  parseEventLogos,
  publicLogoPath,
} from "../../services/providers/sofascore/client.js";
import {
  leagueBadgeUrl,
  lookupLeague as lookupLeagueDefault,
  pickLeagueFromTeam,
  searchTeam as searchTeamDefault,
  teamBadgeUrl,
} from "../../services/providers/thesportsdb/client.js";
import {
  buildCatalogIndex,
  loadCatalogEntries as loadCatalogEntriesDefault,
  lookupCatalogHit as lookupCatalogHitDefault,
  lookupInIndex,
  patchFromHit,
} from "../../services/providers/logoCatalog.js";

const DEFAULT_BATCH = 40;
const DEFAULT_SCAN = 400;
const DEFAULT_RETRY_HOURS = 24;
/** Cover a live match without pulling this morning's leftover LIVE rows. */
const LOOKBACK_HOURS = 3;
const DEFAULT_TSDB_CAP = 25;

export function isSofascoreLogosEnabled(env = process.env) {
  const flag = env.SOFASCORE_LOGOS_ENABLED;
  if (flag == null || flag === "") return true;
  return flag !== "0" && String(flag).toLowerCase() !== "false";
}

export function sofascoreIdFromExternal(externalIds) {
  if (!externalIds || typeof externalIds !== "object") return null;
  const n = Number(externalIds.sofascoreId);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function needsLogo(entity, now = Date.now(), backoffMs = DEFAULT_RETRY_HOURS * 3600_000) {
  if (!entity) return false;
  if (entity.logo) return false;
  const checked = entity.logo_checked_at
    ? new Date(entity.logo_checked_at).getTime()
    : NaN;
  if (!Number.isFinite(checked)) return true;
  return now - checked >= backoffMs;
}

function envInt(name, fallback, { min = 1, max = 500 } = {}) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(max, Math.trunc(n));
}

function markPatch() {
  return { logo_checked_at: new Date() };
}

function leaguePatchFromSofa(parsed) {
  const patch = markPatch();
  if (parsed?.uniqueTournamentId) patch.sofascore_tournament_id = parsed.uniqueTournamentId;
  const logo = publicLogoPath("unique-tournament", parsed?.uniqueTournamentId);
  if (logo) patch.logo = logo;
  return patch;
}

function teamPatchFromSofa(sofascoreId) {
  const patch = markPatch();
  if (sofascoreId) patch.sofascore_team_id = sofascoreId;
  const logo = publicLogoPath("team", sofascoreId);
  if (logo) patch.logo = logo;
  return patch;
}

async function persistLeague(prisma, entity, patch) {
  if (!entity?.id) return false;
  await prisma.league.update({ where: { id: entity.id }, data: patch });
  Object.assign(entity, patch);
  return true;
}

async function persistTeam(prisma, entity, patch) {
  if (!entity?.id) return false;
  await prisma.team.update({ where: { id: entity.id }, data: patch });
  Object.assign(entity, patch);
  return true;
}

async function invalidateLogoCaches(deleteByPattern) {
  await deleteByPattern("fixtures:*");
  await deleteByPattern("live:fixtures:*");
  await deleteByPattern("sidebar-leagues:*");
}

function rowNeedsWork(row, now, backoffMs) {
  return (
    needsLogo(row.league, now, backoffMs) ||
    needsLogo(row.home_team, now, backoffMs) ||
    needsLogo(row.away_team, now, backoffMs)
  );
}

function applySofascoreParse(row, parsed, now, backoffMs) {
  const patches = [];
  if (needsLogo(row.league, now, backoffMs) && parsed.uniqueTournamentId) {
    patches.push(["league", row.league, leaguePatchFromSofa(parsed)]);
  }
  if (needsLogo(row.home_team, now, backoffMs) && parsed.homeTeamId) {
    patches.push(["team", row.home_team, teamPatchFromSofa(parsed.homeTeamId)]);
  }
  if (needsLogo(row.away_team, now, backoffMs) && parsed.awayTeamId) {
    patches.push(["team", row.away_team, teamPatchFromSofa(parsed.awayTeamId)]);
  }
  return patches;
}

/**
 * Resolve missing League.logo / Team.logo for OddsPapi fixtures.
 * Primary: Sofascore `/event/:id` via `external_ids.sofascoreId`.
 * Fallback: TheSportsDB name search (Sofascore JSON is 403 from our VPS).
 */
export async function runOddspapiSyncLogos({
  prisma = prismaDefault,
  fetchEvent = fetchEventDefault,
  searchTeam = searchTeamDefault,
  lookupLeague = lookupLeagueDefault,
  deleteByPattern = deleteByPatternDefault,
  loadCatalogEntries = loadCatalogEntriesDefault,
  lookupCatalogHit = lookupCatalogHitDefault,
  catalogEntries,
  now = Date.now(),
  enabled = isSofascoreLogosEnabled(),
} = {}) {
  if (!enabled) {
    return { skipped: true, reason: "disabled" };
  }

  const batch = envInt("SOFASCORE_LOGOS_BATCH", DEFAULT_BATCH, { max: 80 });
  const scan = envInt("SOFASCORE_LOGOS_SCAN", DEFAULT_SCAN, { max: 800 });
  const tsdbCap = envInt("THESPORTSDB_LOGOS_BATCH", DEFAULT_TSDB_CAP, { max: 80 });
  const retryHours = envInt("SOFASCORE_LOGO_RETRY_HOURS", DEFAULT_RETRY_HOURS, {
    min: 1,
    max: 168,
  });
  const backoffMs = retryHours * 3600_000;
  const from = new Date(now - LOOKBACK_HOURS * 3600_000);
  const daysAhead = getFixturesDaysAhead();
  const to = new Date(now + daysAhead * 86400_000);

  const rows = await prisma.fixture.findMany({
    where: {
      provider: PROVIDER,
      start_time: { gte: from, lte: to },
    },
    select: {
      id: true,
      external_ids: true,
      start_time: true,
      league: {
        select: {
          id: true,
          name: true,
          country: true,
          category_name: true,
          logo: true,
          logo_checked_at: true,
          sofascore_tournament_id: true,
        },
      },
      home_team: {
        select: {
          id: true,
          name: true,
          logo: true,
          logo_checked_at: true,
          sofascore_team_id: true,
        },
      },
      away_team: {
        select: {
          id: true,
          name: true,
          logo: true,
          logo_checked_at: true,
          sofascore_team_id: true,
        },
      },
    },
    orderBy: { start_time: "asc" },
    take: scan,
  });

  const leaguesById = new Map();
  const teamsById = new Map();
  for (const row of rows) {
    if (row.league?.id) {
      if (!leaguesById.has(row.league.id)) leaguesById.set(row.league.id, row.league);
      row.league = leaguesById.get(row.league.id);
    }
    if (row.home_team?.id) {
      if (!teamsById.has(row.home_team.id)) teamsById.set(row.home_team.id, row.home_team);
      row.home_team = teamsById.get(row.home_team.id);
    }
    if (row.away_team?.id) {
      if (!teamsById.has(row.away_team.id)) teamsById.set(row.away_team.id, row.away_team);
      row.away_team = teamsById.get(row.away_team.id);
    }
  }

  const catalog = catalogEntries
    ? buildCatalogIndex(catalogEntries)
    : null;
  const sofaCache = new Map();
  const teamSearchCache = new Map();
  const leagueLookupCache = new Map();
  let fetched = 0;
  let tsdbCalls = 0;
  let updated = 0;
  let failed = 0;
  let sofaForbidden = 0;
  let catalogHits = 0;
  let skippedNoId = rows.filter((row) => !sofascoreIdFromExternal(row.external_ids)).length;

  async function persistPatches(patches) {
    for (const [kind, entity, patch] of patches) {
      const ok =
        kind === "league"
          ? await persistLeague(prisma, entity, patch)
          : await persistTeam(prisma, entity, patch);
      if (ok && patch.logo) updated += 1;
    }
  }

  async function resolveViaCatalog(row) {
    const country = row.league?.country || row.league?.category_name;
    const patches = [];
    if (needsLogo(row.league, now, backoffMs)) {
      const hit = catalog
        ? lookupInIndex(catalog, "league", row.league?.name, country)
        : await lookupCatalogHit(prisma, "league", row.league?.name, country);
      const patch = patchFromHit(row.league, hit, { flag: true });
      if (patch) patches.push(["league", row.league, patch]);
    }
    for (const team of [row.home_team, row.away_team]) {
      if (!needsLogo(team, now, backoffMs)) continue;
      const hit = catalog
        ? lookupInIndex(catalog, "team", team?.name, country)
        : await lookupCatalogHit(prisma, "team", team?.name, country);
      const patch = patchFromHit(team, hit);
      if (patch) patches.push(["team", team, patch]);
    }
    if (patches.length) {
      catalogHits += patches.filter(([, , patch]) => patch.logo).length;
      await persistPatches(patches);
    }
  }

  for (const row of rows) {
    if (rowNeedsWork(row, now, backoffMs)) await resolveViaCatalog(row);
  }

  const candidates = rows.filter((row) => rowNeedsWork(row, now, backoffMs));

  async function markMiss(row) {
    const failPatch = markPatch();
    if (needsLogo(row.league, now, backoffMs)) {
      await persistLeague(prisma, row.league, failPatch);
    }
    if (needsLogo(row.home_team, now, backoffMs)) {
      await persistTeam(prisma, row.home_team, failPatch);
    }
    if (needsLogo(row.away_team, now, backoffMs)) {
      await persistTeam(prisma, row.away_team, failPatch);
    }
  }

  const SKIPPED = Symbol("skipped");

  async function cachedTeamSearch(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return null;
    if (teamSearchCache.has(key)) return teamSearchCache.get(key);
    if (tsdbCalls >= tsdbCap) return SKIPPED;
    tsdbCalls += 1;
    try {
      const team = await searchTeam(name);
      teamSearchCache.set(key, team);
      return team;
    } catch (err) {
      const status = Number(err.status);
      console.warn(`[oddspapi:logos] thesportsdb team "${name}" failed: ${err.message}`);
      if (status === 429 || status >= 500) return SKIPPED;
      teamSearchCache.set(key, null);
      return null;
    }
  }

  async function cachedLeagueLookup(id) {
    if (leagueLookupCache.has(id)) return leagueLookupCache.get(id);
    if (tsdbCalls >= tsdbCap) return SKIPPED;
    tsdbCalls += 1;
    try {
      const league = await lookupLeague(id);
      leagueLookupCache.set(id, league);
      return league;
    } catch (err) {
      leagueLookupCache.set(id, null);
      console.warn(`[oddspapi:logos] thesportsdb league ${id} failed: ${err.message}`);
      return null;
    }
  }

  async function resolveViaTheSportsDb(row) {
    const teams = [row.home_team, row.away_team].filter(Boolean);
    let skipped = false;
    let attempted = false;
    for (const team of teams) {
      if (
        !needsLogo(team, now, backoffMs) &&
        !needsLogo(row.league, now, backoffMs)
      ) {
        continue;
      }
      if (!team.name) continue;
      attempted = true;
      const found = await cachedTeamSearch(team.name);
      if (found === SKIPPED) {
        skipped = true;
        continue;
      }
      if (!found) {
        if (needsLogo(team, now, backoffMs)) {
          await persistTeam(prisma, team, markPatch());
        }
        continue;
      }
      if (needsLogo(team, now, backoffMs)) {
        const badge = teamBadgeUrl(found);
        if (badge) {
          await persistTeam(prisma, team, { ...markPatch(), logo: badge });
          updated += 1;
        } else {
          await persistTeam(prisma, team, markPatch());
        }
      }
      if (needsLogo(row.league, now, backoffMs) && row.league?.name) {
        const hit = pickLeagueFromTeam(found, row.league.name);
        if (!hit) continue;
        const league = await cachedLeagueLookup(hit.id);
        if (league === SKIPPED) {
          skipped = true;
          continue;
        }
        const badge = leagueBadgeUrl(league);
        if (badge) {
          await persistLeague(prisma, row.league, { ...markPatch(), logo: badge });
          updated += 1;
        }
      }
    }
    return { skipped, attempted };
  }

  for (const row of candidates) {
    if (fetched >= batch && tsdbCalls >= tsdbCap) break;
    if (!rowNeedsWork(row, now, backoffMs)) continue;

    const eventId = sofascoreIdFromExternal(row.external_ids);
    if (eventId && fetched < batch && sofaForbidden < 2) {
      let payload = sofaCache.get(eventId);
      if (!payload) {
        try {
          payload = await fetchEvent(eventId);
          sofaCache.set(eventId, payload);
          fetched += 1;
        } catch (err) {
          sofaCache.set(eventId, { __error: err });
          fetched += 1;
          failed += 1;
          if (Number(err.status) === 403) sofaForbidden += 1;
          console.warn(`[oddspapi:logos] event ${eventId} failed: ${err.message || err}`);
        }
      }
      if (payload && !payload.__error) {
        const parsed = parseEventLogos(payload);
        if (parsed) {
          await persistPatches(applySofascoreParse(row, parsed, now, backoffMs));
        }
      }
    }

    if (rowNeedsWork(row, now, backoffMs)) {
      const fb = await resolveViaTheSportsDb(row);
      if (
        rowNeedsWork(row, now, backoffMs) &&
        !fb.skipped &&
        fb.attempted &&
        needsLogo(row.league, now, backoffMs)
      ) {
        await persistLeague(prisma, row.league, markPatch());
      }
    }
  }

  if (updated) {
    await invalidateLogoCaches(deleteByPattern);
  }

  if (fetched || updated || tsdbCalls || catalogHits) {
    console.log(
      `[oddspapi:logos] scanned=${rows.length} candidates=${candidates.length} catalog=${catalogHits} fetched=${fetched} tsdb=${tsdbCalls} updated=${updated} failed=${failed} noId=${skippedNoId}`,
    );
  }

  return {
    scanned: rows.length,
    candidates: candidates.length,
    catalogHits,
    fetched,
    tsdbCalls,
    updated,
    failed,
    skippedNoId,
  };
}
