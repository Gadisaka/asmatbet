import test from "node:test";
import assert from "node:assert/strict";
import {
  parseEventLogos,
  publicLogoPath,
  teamImageUrl,
  uniqueTournamentImageUrl,
  resetSofascorePace,
} from "../../services/providers/sofascore/client.js";
import {
  isSofascoreLogosEnabled,
  needsLogo,
  runOddspapiSyncLogos,
  sofascoreIdFromExternal,
} from "../../jobs/oddspapi/syncLogos.js";
import {
  foldName,
  pickLeagueFromTeam,
  pickSoccerTeam,
} from "../../services/providers/thesportsdb/client.js";

const EVENT = {
  event: {
    homeTeam: { id: 44, name: "Liverpool" },
    awayTeam: { id: 35, name: "Manchester United" },
    tournament: { uniqueTournament: { id: 17, name: "Premier League" } },
  },
};

function entity(id, extra = {}) {
  return { id, logo: null, logo_checked_at: null, ...extra };
}

function makePrisma(rows) {
  const updates = { league: [], team: [] };
  return {
    updates,
    prisma: {
      fixture: {
        findMany: async () => rows,
      },
      league: {
        update: async ({ where, data }) => {
          updates.league.push({ id: where.id, data });
        },
      },
      team: {
        update: async ({ where, data }) => {
          updates.team.push({ id: where.id, data });
        },
      },
    },
  };
}

test("sofascore image URL helpers", () => {
  assert.equal(
    teamImageUrl(44),
    "https://img.sofascore.com/api/v1/team/44/image",
  );
  assert.equal(
    uniqueTournamentImageUrl(17),
    "https://img.sofascore.com/api/v1/unique-tournament/17/image",
  );
  assert.equal(publicLogoPath("team", 44), "/api/football/logo/team/44");
  assert.equal(
    publicLogoPath("unique-tournament", 17),
    "/api/football/logo/unique-tournament/17",
  );
  assert.equal(teamImageUrl(null), null);
});

test("parseEventLogos reads team and unique-tournament ids", () => {
  const parsed = parseEventLogos(EVENT);
  assert.equal(parsed.homeTeamId, 44);
  assert.equal(parsed.awayTeamId, 35);
  assert.equal(parsed.uniqueTournamentId, 17);
  assert.equal(parsed.homeLogo, teamImageUrl(44));
  assert.equal(parsed.leagueLogo, uniqueTournamentImageUrl(17));
});

test("sofascoreIdFromExternal requires a positive id", () => {
  assert.equal(sofascoreIdFromExternal({ sofascoreId: 15676100 }), 15676100);
  assert.equal(sofascoreIdFromExternal({ sofascoreId: null }), null);
  assert.equal(sofascoreIdFromExternal({}), null);
  assert.equal(sofascoreIdFromExternal(null), null);
});

test("needsLogo skips entities that already have a logo or a fresh miss", () => {
  const now = Date.parse("2026-09-02T08:00:00.000Z");
  assert.equal(needsLogo({ logo: null, logo_checked_at: null }, now), true);
  assert.equal(needsLogo({ logo: "https://x/y", logo_checked_at: null }, now), false);
  assert.equal(
    needsLogo({ logo: null, logo_checked_at: new Date(now - 60_000) }, now, 24 * 3600_000),
    false,
  );
  assert.equal(
    needsLogo(
      { logo: null, logo_checked_at: new Date(now - 25 * 3600_000) },
      now,
      24 * 3600_000,
    ),
    true,
  );
});

test("kill switch reads SOFASCORE_LOGOS_ENABLED", () => {
  assert.equal(isSofascoreLogosEnabled({}), true);
  assert.equal(isSofascoreLogosEnabled({ SOFASCORE_LOGOS_ENABLED: "0" }), false);
  assert.equal(isSofascoreLogosEnabled({ SOFASCORE_LOGOS_ENABLED: "false" }), false);
  assert.equal(isSofascoreLogosEnabled({ SOFASCORE_LOGOS_ENABLED: "1" }), true);
});

test("missing sofascoreId is a no-op", async () => {
  resetSofascorePace();
  const { prisma, updates } = makePrisma([
    {
      id: "f1",
      external_ids: {},
      league: entity("l1"),
      home_team: entity("h1"),
      away_team: entity("a1"),
    },
  ]);
  let fetched = 0;
  const result = await runOddspapiSyncLogos({
    prisma,
    fetchEvent: async () => {
      fetched += 1;
      throw new Error("should not fetch");
    },
    deleteByPattern: async () => 0,
    enabled: true,
    now: Date.parse("2026-09-02T08:00:00.000Z"),
  });
  assert.equal(fetched, 0);
  assert.equal(result.fetched, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skippedNoId, 1);
  assert.equal(updates.league.length, 0);
  assert.equal(updates.team.length, 0);
});

test("persists league and club logos from a stubbed event", async () => {
  resetSofascorePace();
  const { prisma, updates } = makePrisma([
    {
      id: "f1",
      external_ids: { sofascoreId: 15676100 },
      league: entity("l1"),
      home_team: entity("h1"),
      away_team: entity("a1"),
    },
  ]);
  const invalidated = [];
  const result = await runOddspapiSyncLogos({
    prisma,
    fetchEvent: async (id) => {
      assert.equal(id, 15676100);
      return EVENT;
    },
    deleteByPattern: async (pattern) => {
      invalidated.push(pattern);
      return 1;
    },
    enabled: true,
    now: Date.parse("2026-09-02T08:00:00.000Z"),
  });
  assert.equal(result.fetched, 1);
  assert.equal(result.updated, 3);
  assert.equal(updates.league[0].data.logo, publicLogoPath("unique-tournament", 17));
  assert.equal(updates.league[0].data.sofascore_tournament_id, 17);
  assert.equal(updates.team[0].data.logo, publicLogoPath("team", 44));
  assert.equal(updates.team[1].data.logo, publicLogoPath("team", 35));
  assert.deepEqual(invalidated, [
    "fixtures:*",
    "live:fixtures:*",
    "sidebar-leagues:*",
  ]);
});

test("TheSportsDB name matching folds FC suffixes", () => {
  assert.equal(foldName("Liverpool FC"), "liverpool");
  const team = pickSoccerTeam(
    [
      { strSport: "Soccer", strTeam: "Liverpool", strTeamAlternate: "LFC, Liverpool FC" },
      { strSport: "Basketball", strTeam: "Liverpool" },
    ],
    "Liverpool FC",
  );
  assert.equal(team.strTeam, "Liverpool");
  const hit = pickLeagueFromTeam(
    {
      idLeague: "4328",
      strLeague: "English Premier League",
      idLeague4: "4480",
      strLeague4: "UEFA Champions League",
    },
    "Premier League",
  );
  assert.equal(hit.id, 4328);
});

test("Sofascore 403 falls back to TheSportsDB badges", async () => {
  resetSofascorePace();
  const { prisma, updates } = makePrisma([
    {
      id: "f1",
      external_ids: { sofascoreId: 15676100 },
      league: entity("l1", { name: "Premier League" }),
      home_team: entity("h1", { name: "Liverpool FC" }),
      away_team: entity("a1", { name: "Manchester United" }),
    },
  ]);
  const result = await runOddspapiSyncLogos({
    prisma,
    fetchEvent: async () => {
      const err = new Error("sofascore 403");
      err.status = 403;
      throw err;
    },
    searchTeam: async (name) => {
      if (String(name).includes("Liverpool")) {
        return {
          strSport: "Soccer",
          strTeam: "Liverpool",
          strBadge: "https://r2.thesportsdb.com/images/media/team/badge/liv.png",
          idLeague: "4328",
          strLeague: "English Premier League",
        };
      }
      return {
        strSport: "Soccer",
        strTeam: "Manchester United",
        strBadge: "https://r2.thesportsdb.com/images/media/team/badge/mun.png",
        idLeague: "4328",
        strLeague: "English Premier League",
      };
    },
    lookupLeague: async () => ({
      strBadge: "https://r2.thesportsdb.com/images/media/league/badge/epl.png",
    }),
    deleteByPattern: async () => 1,
    enabled: true,
    now: Date.parse("2026-09-02T08:00:00.000Z"),
  });
  assert.equal(result.failed, 1);
  assert.equal(result.tsdbCalls, 3);
  assert.equal(result.updated, 3);
  assert.equal(
    updates.team[0].data.logo,
    "https://r2.thesportsdb.com/images/media/team/badge/liv.png",
  );
  assert.equal(
    updates.league[0].data.logo,
    "https://r2.thesportsdb.com/images/media/league/badge/epl.png",
  );
});

test("TheSportsDB 429 does not mark a miss", async () => {
  const { prisma, updates } = makePrisma([
    {
      id: "f1",
      external_ids: {},
      league: entity("l1", { name: "Premier League" }),
      home_team: entity("h1", { name: "Liverpool FC" }),
      away_team: entity("a1", { name: "Manchester United" }),
    },
  ]);
  const err = new Error("thesportsdb 429");
  err.status = 429;
  const result = await runOddspapiSyncLogos({
    prisma,
    fetchEvent: async () => {
      throw new Error("should not fetch");
    },
    searchTeam: async () => {
      throw err;
    },
    lookupLeague: async () => {
      throw new Error("should not lookup");
    },
    deleteByPattern: async () => 0,
    enabled: true,
    now: Date.parse("2026-09-02T18:00:00.000Z"),
  });
  assert.equal(result.updated, 0);
  assert.equal(updates.team.length, 0);
  assert.equal(updates.league.length, 0);
});

test("disabled flag skips all work", async () => {
  const result = await runOddspapiSyncLogos({
    enabled: false,
    prisma: {
      fixture: {
        findMany: async () => {
          throw new Error("should not query");
        },
      },
    },
  });
  assert.deepEqual(result, { skipped: true, reason: "disabled" });
});
