/**
 * One-shot API-Football logo catalogue pull.
 *
 * Calls /leagues once, then /teams?league=&season= per league as quota
 * allows. Writes SportsLogo rows and matches them onto OddsPapi League/Team.
 * Do not put API_FOOTBALL_KEY in the running API/worker env — that would
 * wake the old API-Sports cron. Pass the key only to this process.
 */

import {
  applyCatalogToOddspapi,
  buildCatalogIndex,
  CATALOG_PROVIDER,
  catalogRowFromLeague,
  catalogRowFromTeam,
  lookupInIndex,
} from "../logoCatalog.js";
import { PROVIDER } from "../oddspapi/config.js";
import { getFixturesDaysAhead } from "../../../Config/ingestionConfig.js";

const BASE = "https://v3.football.api-sports.io";
const DEFAULT_PACE_MS = 500;
const DEFAULT_RESERVE = 8;

function sleep(ms, sleepFn) {
  const wait = Number(ms) || 0;
  if (wait <= 0) return Promise.resolve();
  if (typeof sleepFn === "function") return sleepFn(wait);
  return new Promise((resolve) => setTimeout(resolve, wait));
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function readQuota(headers = {}) {
  const get = (name) => {
    const n = Number(headerGet(headers, name));
    return Number.isFinite(n) ? n : null;
  };
  return {
    dayLimit: get("x-ratelimit-requests-limit"),
    dayRemaining: get("x-ratelimit-requests-remaining"),
    minuteLimit: get("x-ratelimit-limit"),
    minuteRemaining: get("x-ratelimit-remaining"),
  };
}

export function createLogoClient({
  apiKey,
  fetchImpl,
  sleepFn,
  paceMs = DEFAULT_PACE_MS,
} = {}) {
  if (!apiKey) {
    throw new Error("API_FOOTBALL_KEY is required for logo ingest");
  }
  let lastAt = 0;
  let quota = {
    dayLimit: null,
    dayRemaining: null,
    minuteLimit: null,
    minuteRemaining: null,
  };

  async function request(path, params = {}) {
    const wait = lastAt + paceMs - Date.now();
    if (wait > 0) await sleep(wait, sleepFn);
    lastAt = Date.now();

    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }

    const res = await (fetchImpl || fetch)(url, {
      headers: { "x-apisports-key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    quota = { ...quota, ...readQuota(res.headers || {}) };

    if (res.status === 429) {
      const err = new Error("API-Football 429");
      err.status = 429;
      err.quota = quota;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`API-Football ${res.status}`);
      err.status = res.status;
      err.quota = quota;
      throw err;
    }

    const data = await res.json();
    if (data?.errors && Object.keys(data.errors).length) {
      const err = new Error(
        `API-Football errors: ${JSON.stringify(data.errors)}`,
      );
      err.errors = data.errors;
      err.status = data.errors.rateLimit ? 429 : res.status;
      err.quota = quota;
      throw err;
    }
    return { response: data?.response ?? data, quota };
  }

  return {
    quota: () => ({ ...quota }),
    async status() {
      const { response, quota: q } = await request("/status");
      const body = Array.isArray(response) ? response[0] : response;
      return {
        plan: body?.subscription?.plan || null,
        active: body?.subscription?.active ?? null,
        current: body?.requests?.current ?? q.dayLimit,
        limitDay: body?.requests?.limit_day ?? q.dayLimit,
        remaining:
          body?.requests?.limit_day != null && body?.requests?.current != null
            ? Math.max(0, body.requests.limit_day - body.requests.current)
            : q.dayRemaining,
        quota: q,
      };
    },
    async leagues() {
      const { response, quota: q } = await request("/leagues");
      return { leagues: Array.isArray(response) ? response : [], quota: q };
    },
    async teams(leagueId, season) {
      const { response, quota: q } = await request("/teams", {
        league: leagueId,
        season,
      });
      return { teams: Array.isArray(response) ? response : [], quota: q };
    },
  };
}

async function upsertCatalogRow(prisma, row) {
  const { teams_ingested_at: _ignore, ...data } = row;
  return prisma.sportsLogo.upsert({
    where: {
      provider_kind_api_id: {
        provider: row.provider,
        kind: row.kind,
        api_id: row.api_id,
      },
    },
    create: row,
    update: data,
  });
}

function remainingOf(client, status) {
  const q = client.quota();
  if (q.dayRemaining != null) return q.dayRemaining;
  if (status?.remaining != null) return status.remaining;
  return null;
}

export async function upcomingOddspapiLeagues(prisma, now = Date.now()) {
  const from = new Date(now - 3 * 3600_000);
  const to = new Date(now + getFixturesDaysAhead() * 86400_000);
  const rows = await prisma.fixture.findMany({
    where: {
      provider: PROVIDER,
      start_time: { gte: from, lte: to },
    },
    select: {
      league: {
        select: {
          id: true,
          name: true,
          country: true,
          category_name: true,
        },
      },
    },
  });
  const byId = new Map();
  for (const row of rows) {
    if (row.league?.id && !byId.has(row.league.id)) {
      byId.set(row.league.id, row.league);
    }
  }
  return [...byId.values()];
}

export function prioritizeLeagueFetches(apiLeagues, upcomingHits) {
  const upcomingIds = new Set(
    upcomingHits.map((h) => h?.api_id).filter((id) => Number.isFinite(id)),
  );
  const current = [];
  for (const entry of apiLeagues) {
    const row = catalogRowFromLeague(entry);
    if (!row?.season) continue;
    current.push({ entry, row, upcoming: upcomingIds.has(row.api_id) });
  }
  current.sort((a, b) => Number(b.upcoming) - Number(a.upcoming));
  return current;
}

export async function runApiFootballLogoIngest({
  prisma,
  client,
  deleteByPattern,
  applyOnly = false,
  leaguesOnly = false,
  upcomingOnly = false,
  force = false,
  reserve = DEFAULT_RESERVE,
  now = Date.now(),
  log = console.log,
} = {}) {
  if (!prisma) throw new Error("prisma is required");

  if (applyOnly) {
    const applied = await applyCatalogToOddspapi({
      prisma,
      deleteByPattern,
      now: new Date(now),
      log,
    });
    log(`[logo-ingest] apply-only leagues=${applied.leagues} teams=${applied.teams}`);
    return { applied, calls: 0 };
  }

  if (!client) throw new Error("API-Football client is required");

  const status = await client.status();
  log(
    `[logo-ingest] plan=${status.plan || "?"} remaining=${status.remaining ?? "?"}/${status.limitDay ?? "?"}`,
  );

  const { leagues: apiLeagues } = await client.leagues();
  log(`[logo-ingest] /leagues returned ${apiLeagues.length}`);

  let leagueRows = 0;
  for (const entry of apiLeagues) {
    const row = catalogRowFromLeague(entry);
    if (!row) continue;
    await upsertCatalogRow(prisma, row);
    leagueRows += 1;
  }

  const catalogSoFar = await prisma.sportsLogo.findMany({
    where: { provider: CATALOG_PROVIDER, kind: "league" },
    select: {
      api_id: true,
      name: true,
      country: true,
      logo: true,
      extra_names: true,
      teams_ingested_at: true,
      kind: true,
    },
  });
  const index = buildCatalogIndex(catalogSoFar);
  const appliedLeagues = await applyCatalogToOddspapi({
    prisma,
    deleteByPattern,
    now: new Date(now),
    log,
  });
  log(
    `[logo-ingest] stored leagues=${leagueRows} applied leagues=${appliedLeagues.leagues} teams=${appliedLeagues.teams}`,
  );

  if (leaguesOnly) {
    return {
      status,
      storedLeagues: leagueRows,
      storedTeams: 0,
      applied: appliedLeagues,
      calls: 2,
    };
  }

  const upcoming = await upcomingOddspapiLeagues(prisma, now);
  const upcomingHits = upcoming
    .map((lg) =>
      lookupInIndex(index, "league", lg.name, lg.country || lg.category_name),
    )
    .filter(Boolean);
  log(
    `[logo-ingest] upcoming oddspapi leagues=${upcoming.length} matched=${upcomingHits.length}`,
  );

  const queued = prioritizeLeagueFetches(apiLeagues, upcomingHits);
  const already = new Set(
    catalogSoFar
      .filter((r) => r.kind === "league" && r.teams_ingested_at && !force)
      .map((r) => r.api_id),
  );

  let storedTeams = 0;
  let fetchedLeagues = 0;
  let stopped = null;

  for (const item of queued) {
    if (upcomingOnly && !item.upcoming) continue;
    if (already.has(item.row.api_id)) continue;

    const left = remainingOf(client, status);
    if (left != null && left <= reserve) {
      stopped = `quota reserve ${left}<=${reserve}`;
      break;
    }

    let teams;
    try {
      ({ teams } = await client.teams(item.row.api_id, item.row.season));
    } catch (err) {
      if (err.status === 429) {
        log("[logo-ingest] 429 — backing off 8s");
        await sleep(8000);
        try {
          ({ teams } = await client.teams(item.row.api_id, item.row.season));
        } catch (err2) {
          stopped = err2.message;
          log(`[logo-ingest] stop: ${err2.message}`);
          break;
        }
      } else {
        log(
          `[logo-ingest] teams ${item.row.api_id} ${item.row.name} failed: ${err.message}`,
        );
        continue;
      }
    }

    for (const entry of teams) {
      const row = catalogRowFromTeam(entry);
      if (!row) continue;
      row.season = item.row.season;
      await upsertCatalogRow(prisma, row);
      storedTeams += 1;
    }

    await prisma.sportsLogo.update({
      where: {
        provider_kind_api_id: {
          provider: CATALOG_PROVIDER,
          kind: "league",
          api_id: item.row.api_id,
        },
      },
      data: { teams_ingested_at: new Date(now), season: item.row.season },
    });
    fetchedLeagues += 1;
    if (fetchedLeagues % 10 === 0 || item.upcoming) {
      const rem = remainingOf(client, status);
      log(
        `[logo-ingest] teams ${item.row.name} (${item.row.api_id}/${item.row.season}) n=${teams.length} fetched=${fetchedLeagues} remaining=${rem ?? "?"}`,
      );
    }
  }

  const applied = await applyCatalogToOddspapi({
    prisma,
    deleteByPattern,
    now: new Date(now),
    log,
  });
  log(
    `[logo-ingest] done storedTeams=${storedTeams} fetchedLeagues=${fetchedLeagues} applied leagues=${applied.leagues} teams=${applied.teams}${stopped ? ` stopped=${stopped}` : ""}`,
  );

  return {
    status,
    storedLeagues: leagueRows,
    storedTeams,
    fetchedLeagues,
    applied,
    stopped,
    remaining: remainingOf(client, status),
  };
}
