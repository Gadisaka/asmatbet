import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogIndex,
  canonicalCountry,
  canonicalName,
  leagueNameWithoutCountry,
  lookupKeys,
  catalogRowFromLeague,
  catalogRowFromTeam,
  foldName,
  lookupCatalogHit,
  lookupInIndex,
  nameScore,
  patchFromHit,
  pickBest,
  shouldReplaceLogo,
} from "../../services/providers/logoCatalog.js";
import { runOddspapiSyncLogos } from "../../jobs/oddspapi/syncLogos.js";

test("aliases fold Man City and UCL onto catalogue names", () => {
  assert.equal(canonicalName("Man City"), "manchester city");
  assert.equal(canonicalName("Manchester City FC"), "manchester city");
  assert.equal(canonicalName("UEFA Champions League", { stripClubSuffix: false }), "champions league");
  assert.equal(canonicalCountry("Europe"), "international");
  assert.equal(canonicalCountry("England"), "england");
  assert.equal(nameScore("Man Utd", "Manchester United"), 100);
  assert.equal(nameScore("AFC Bournemouth", "Bournemouth"), 100);
});

test("shared nicknames and country spellings fold together", () => {
  assert.equal(canonicalCountry("Turkiye"), "turkey");
  assert.equal(canonicalCountry("England Amateur"), "england");
  assert.equal(canonicalCountry("Germany Amateur"), "germany");
  assert.equal(canonicalName("West Bromwich Albion"), "west brom");
  assert.equal(canonicalName("LaLiga", { stripClubSuffix: false }), "la liga");
  assert.equal(canonicalName("EFL Cup", { stripClubSuffix: false }), "league cup");
  assert.equal(nameScore("Sheffield United", "Sheffield Utd"), 100);
  assert.equal(nameScore("Bolton Wanderers", "Bolton"), 80);
  assert.ok(lookupKeys("Sheffield United", "team").includes("sheffield utd"));
  assert.ok(lookupKeys("Bolton Wanderers", "team").includes("bolton"));
});

test("pickBest uses country so Championship is not Scottish", () => {
  const entries = [
    { name: "Championship", country: "Scotland", logo: "scot" },
    { name: "Championship", country: "England", logo: "eng" },
  ];
  const hit = pickBest(entries, "Championship", "England", "league");
  assert.equal(hit.logo, "eng");
  assert.equal(pickBest(entries, "Championship", "Wales", "league"), null);
});

test("Wrexham in the Championship matches the Welsh catalogue row", () => {
  const hit = pickBest(
    [{ name: "Wrexham", country: "Wales", logo: "wrx" }],
    "Wrexham AFC",
    "England",
    "team",
  );
  assert.equal(hit.logo, "wrx");
});

test("Super Lig in Turkiye matches Süper Lig in Turkey", () => {
  const hit = pickBest(
    [{ name: "Süper Lig", country: "Turkey", logo: "super" }],
    "Super Lig",
    "Turkiye",
    "league",
  );
  assert.equal(hit.logo, "super");
});

test("Aston Villa in UCL prefers England over Antigua", () => {
  const hit = pickBest(
    [
      { name: "Aston Villa", country: "England", logo: "avl" },
      { name: "Aston Villa", country: "Antigua-and-Barbuda", logo: "ant" },
    ],
    "Aston Villa",
    "International Clubs",
    "team",
  );
  assert.equal(hit.logo, "avl");
});

test("Primera Division is La Liga only in Spain, not Nicaragua", () => {
  assert.equal(
    canonicalName("Primera Division", { stripClubSuffix: false, country: "Spain" }),
    "la liga",
  );
  assert.equal(
    canonicalName("Primera Division", { stripClubSuffix: false, country: "Nicaragua" }),
    "primera division",
  );
  const entries = [
    { name: "La Liga", country: "Spain", logo: "esp" },
    { name: "Primera Division", country: "Nicaragua", logo: "nic" },
  ];
  assert.equal(
    pickBest(entries, "Primera Division", "Nicaragua", "league").logo,
    "nic",
  );
  assert.equal(
    pickBest(entries, "Primera Division", "Spain", "league").logo,
    "esp",
  );
});

test("Greece Cup is the Greek domestic cup", () => {
  assert.equal(leagueNameWithoutCountry("Greece Cup", "Greece"), "cup");
  assert.equal(canonicalName("Greece Cup", { stripClubSuffix: false }), "greek cup");
  assert.ok(lookupKeys("Greece Cup", "league").includes("cup"));
  const hit = pickBest(
    [
      { name: "Cup", country: "Greece", logo: "gre-cup" },
      { name: "Cup", country: "Turkey", logo: "tur-cup" },
    ],
    "Greece Cup",
    "Greece",
    "league",
  );
  assert.equal(hit.logo, "gre-cup");
});

test("Turkish 1. Lig clubs fold onto API-Football names", () => {
  assert.equal(foldName("Iğdır FK"), "igdir");
  assert.equal(foldName("Igdir FK"), "igdir");
  assert.equal(foldName("Manisa F.K."), "manisa");
  assert.equal(foldName("Manisa Futbol Kulubu"), "manisa");
  assert.equal(nameScore("Igdir FK", "Iğdır FK"), 100);
  assert.equal(nameScore("Manisa Futbol Kulubu", "Manisa F.K."), 100);
  assert.equal(
    pickBest(
      [{ name: "Iğdır FK", country: "Turkey", logo: "igd" }],
      "Igdir FK",
      "Turkiye",
      "team",
    ).logo,
    "igd",
  );
  assert.equal(
    pickBest(
      [{ name: "Manisa F.K.", country: "Turkey", logo: "man" }],
      "Manisa Futbol Kulubu",
      "Turkiye",
      "team",
    ).logo,
    "man",
  );
});

test("PAOK Thessaloniki and OFI Crete match the short catalogue names", () => {
  assert.equal(canonicalName("PAOK Thessaloniki"), "paok");
  assert.equal(canonicalName("OFI Crete"), "ofi");
  assert.equal(
    pickBest(
      [{ name: "PAOK", country: "Greece", logo: "paok" }],
      "PAOK Thessaloniki",
      "Greece",
      "team",
    ).logo,
    "paok",
  );
  assert.equal(
    pickBest(
      [{ name: "OFI", country: "Greece", logo: "ofi" }],
      "OFI Crete",
      "Greece",
      "team",
    ).logo,
    "ofi",
  );
});

test("Worksop in England Amateur matches England", () => {
  const hit = pickBest(
    [{ name: "Worksop Town", country: "England", logo: "wor" }],
    "Worksop Town",
    "England Amateur",
    "team",
  );
  assert.equal(hit.logo, "wor");
});

test("exact club names still match in continental cups", () => {
  const teams = [
    { name: "Boca Juniors", country: "Argentina", logo: "boca" },
    { name: "Boca Unidos", country: "Argentina", logo: "unidos" },
  ];
  assert.equal(
    pickBest(teams, "Boca Juniors", "International Clubs", "team").logo,
    "boca",
  );
});

test("Arsenal in England does not match Arsenal de Sarandi", () => {
  const teams = [
    { name: "Arsenal", country: "England", logo: "afc" },
    { name: "Arsenal de Sarandi", country: "Argentina", logo: "sarandi" },
  ];
  assert.equal(pickBest(teams, "Arsenal", "England", "team").logo, "afc");
  assert.equal(
    pickBest(teams, "Arsenal de Sarandi", "Argentina", "team").logo,
    "sarandi",
  );
});

test("catalogue rows prefer API logo URLs", () => {
  const league = catalogRowFromLeague({
    league: { id: 39, name: "Premier League", logo: "https://media.api-sports.io/football/leagues/39.png" },
    country: { name: "England", flag: "https://media.api-sports.io/flags/gb.svg" },
    seasons: [{ year: 2026, current: true }],
  });
  assert.equal(league.api_id, 39);
  assert.equal(league.season, 2026);
  assert.equal(league.country_fold, "england");

  const team = catalogRowFromTeam({
    team: { id: 40, name: "Liverpool", code: "LIV", country: "England", logo: "https://media.api-sports.io/football/teams/40.png" },
  });
  assert.equal(team.api_id, 40);
  assert.deepEqual(team.extra_names, ["LIV"]);
});

test("shouldReplaceLogo only swaps empty or Sofascore proxies", () => {
  assert.equal(shouldReplaceLogo(null, "https://x/y"), true);
  assert.equal(
    shouldReplaceLogo("/api/football/logo/team/1", "https://media.api-sports.io/football/teams/1.png"),
    true,
  );
  assert.equal(
    shouldReplaceLogo(
      "https://r2.thesportsdb.com/images/media/team/badge/liv.png",
      "https://media.api-sports.io/football/teams/40.png",
    ),
    false,
  );
});

test("patchFromHit fills a missing league flag", () => {
  const patch = patchFromHit(
    { logo: null, country_flag: null },
    {
      logo: "https://media.api-sports.io/football/leagues/39.png",
      flag: "https://media.api-sports.io/flags/gb.svg",
    },
    { flag: true },
  );
  assert.equal(patch.logo, "https://media.api-sports.io/football/leagues/39.png");
  assert.equal(patch.flag || patch.country_flag, "https://media.api-sports.io/flags/gb.svg");
});

test("syncLogos applies the local catalogue before Sofascore", async () => {
  const updates = { league: [], team: [] };
  const prisma = {
    fixture: {
      findMany: async () => [
        {
          id: "f1",
          external_ids: { sofascoreId: 1 },
          league: {
            id: "l1",
            name: "Premier League",
            country: "England",
            logo: null,
            logo_checked_at: null,
          },
          home_team: { id: "h1", name: "Liverpool", logo: null, logo_checked_at: null },
          away_team: { id: "a1", name: "Man City", logo: null, logo_checked_at: null },
        },
      ],
    },
    league: {
      update: async ({ where, data }) => updates.league.push({ id: where.id, data }),
    },
    team: {
      update: async ({ where, data }) => updates.team.push({ id: where.id, data }),
    },
  };
  let fetched = 0;
  const result = await runOddspapiSyncLogos({
    prisma,
    catalogEntries: [
      {
        kind: "league",
        name: "Premier League",
        country: "England",
        logo: "https://media.api-sports.io/football/leagues/39.png",
      },
      {
        kind: "team",
        name: "Liverpool",
        country: "England",
        logo: "https://media.api-sports.io/football/teams/40.png",
      },
      {
        kind: "team",
        name: "Manchester City",
        country: "England",
        logo: "https://media.api-sports.io/football/teams/50.png",
      },
    ],
    fetchEvent: async () => {
      fetched += 1;
      throw new Error("should not fetch");
    },
    deleteByPattern: async () => 1,
    enabled: true,
    now: Date.parse("2026-09-02T20:00:00.000Z"),
  });
  assert.equal(fetched, 0);
  assert.equal(result.catalogHits, 3);
  assert.equal(result.updated, 3);
  assert.equal(result.candidates, 0);
  assert.equal(
    updates.league[0].data.logo,
    "https://media.api-sports.io/football/leagues/39.png",
  );
});

test("lookupCatalogHit queries name_fold keys including UCL aliases", async () => {
  const seen = [];
  const prisma = {
    sportsLogo: {
      findMany: async ({ where }) => {
        seen.push(where.name_fold.in);
        return [
          {
            kind: "league",
            name: "UEFA Champions League",
            country: "World",
            logo: "ucl",
          },
        ];
      },
    },
  };
  const hit = await lookupCatalogHit(prisma, "league", "Champions League", "Europe");
  assert.equal(hit.logo, "ucl");
  assert.ok(seen[0].includes("champions league"));
  assert.ok(seen[0].includes("uefa champions league"));
});

test("lookupInIndex scores from a built index", () => {
  const index = buildCatalogIndex([
    {
      kind: "league",
      name: "UEFA Champions League",
      country: "World",
      logo: "ucl",
    },
    { kind: "team", name: "Liverpool", country: "England", logo: "liv" },
  ]);
  assert.equal(
    lookupInIndex(index, "league", "Champions League", "Europe").logo,
    "ucl",
  );
  assert.equal(lookupInIndex(index, "team", "Liverpool FC", "England").logo, "liv");
});
