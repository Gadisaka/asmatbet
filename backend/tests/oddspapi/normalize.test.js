import test from "node:test";
import assert from "node:assert/strict";
import {
  LEAGUE_ID_BASE,
  TEAM_ID_BASE,
  mapStatusId,
  namespacedLeagueId,
  namespacedTeamId,
  parseProviderFixtureId,
} from "../../services/providers/oddspapi/config.js";
import {
  flattenOdds,
  fixtureWindows,
  marketStorageName,
  mergeScorePeriods,
  normalizeFixture,
} from "../../services/providers/oddspapi/normalize.js";
import { asList } from "../../services/providers/oddspapi/client.js";
import { allowOddsTier } from "../../services/providers/oddspapi/quota.js";
import { andNotOddspapi, PROVIDER_ODDSPAPI } from "../../services/providers/publicScope.js";
import { mergeBookmakerOdds } from "../../services/providers/oddspapi/mergeBookmakerOdds.js";

test("parseProviderFixtureId extracts a safe integer", () => {
  assert.equal(parseProviderFixtureId("id1000001761301153"), 1000001761301153);
  assert.equal(parseProviderFixtureId("nope"), null);
  assert.equal(parseProviderFixtureId(""), null);
});

test("namespace league/team ids away from API-Football", () => {
  assert.equal(namespacedLeagueId(17), LEAGUE_ID_BASE + 17);
  assert.equal(namespacedTeamId(35), TEAM_ID_BASE + 35);
  assert.ok(namespacedLeagueId(17) > 100_000);
});

test("statusId maps to our short codes", () => {
  assert.equal(mapStatusId(0), "NS");
  assert.equal(mapStatusId(1), "LIVE");
  assert.equal(mapStatusId(2), "FT");
  assert.equal(mapStatusId(3), "CANC");
  assert.equal(mapStatusId(99), "NS");
});

test("fixture windows stay under the 10-day sportId cap", () => {
  const w = fixtureWindows(14);
  assert.deepEqual(w, [
    { startOffset: 0, endOffset: 8 },
    { startOffset: 9, endOffset: 13 },
  ]);
  for (const win of w) {
    assert.ok(win.endOffset - win.startOffset + 1 <= 9);
  }
});

test("normalizeFixture maps OddsPapi payload", () => {
  const fx = normalizeFixture({
    fixtureId: "id1000001761301153",
    participant1Id: 35,
    participant2Id: 34,
    tournamentId: 17,
    seasonId: 1,
    statusId: 0,
    startTime: "2026-09-01T15:00:00.000Z",
    tournamentName: "Premier League",
    categoryName: "England",
    participant1Name: "Liverpool",
    participant2Name: "Man Utd",
    externalProviders: { sofascoreId: 1 },
  });
  assert.equal(fx.api_fixture_id, 1000001761301153);
  assert.equal(fx.provider, "oddspapi");
  assert.equal(fx.status, "NS");
  assert.equal(fx.api_league_id, LEAGUE_ID_BASE + 17);
  assert.equal(fx.home_api_team_id, TEAM_ID_BASE + 35);
});

test("flattenOdds keeps player props and 1xbet prices", () => {
  const { lines, suspended } = flattenOdds(
    {
      bookmakerOdds: {
        "1xbet": {
          suspended: false,
          markets: {
            101: {
              marketActive: true,
              outcomes: {
                101: {
                  players: {
                    0: { price: 2.1, active: true, bookmakerOutcomeId: "home" },
                  },
                },
                102: {
                  players: {
                    0: { price: 3.4, active: true, bookmakerOutcomeId: "draw" },
                  },
                },
              },
            },
            999: {
              outcomes: {
                1: {
                  players: {
                    42: { price: 1.5, playerName: "Salah" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "1xbet",
  );
  assert.equal(suspended, false);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].value, "home");
  assert.equal(lines[0].marketId, 101);
  const prop = lines.find((l) => l.playerId === 42);
  assert.equal(prop.playerName, "Salah");
  assert.equal(prop.price, 1.5);
});

test("flattenOdds keeps changedAt and marks inactive when marketActive is false", () => {
  const { lines, suspended } = flattenOdds(
    {
      bookmakerOdds: {
        "1xbet": {
          suspended: false,
          markets: {
            101: {
              marketActive: false,
              outcomes: {
                101: {
                  players: {
                    0: {
                      price: 4.61,
                      active: true,
                      bookmakerOutcomeId: "home",
                      changedAt: "2026-09-01T18:00:00.000Z",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "1xbet",
  );
  assert.equal(suspended, false);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].active, false);
  assert.equal(lines[0].changedAt, "2026-09-01T18:00:00.000Z");
});

test("flattenOdds marks every line inactive when the book is suspended", () => {
  const { lines, suspended } = flattenOdds(
    {
      bookmakerOdds: {
        "1xbet": {
          suspended: true,
          markets: {
            101: {
              marketActive: true,
              outcomes: {
                101: {
                  players: {
                    0: { price: 1.9, active: true, bookmakerOutcomeId: "home" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "1xbet",
  );
  assert.equal(suspended, true);
  assert.equal(lines[0].active, false);
});

test("marketStorageName keeps marketId unique per fixture", () => {
  assert.equal(marketStorageName(101, "Full Time Result"), "101:Full Time Result");
});

test("asList accepts array or single fixture object", () => {
  assert.equal(asList([{ fixtureId: "a" }]).length, 1);
  assert.equal(asList({ fixtureId: "a" }).length, 1);
  assert.equal(asList({ error: { code: "X" } }).length, 0);
});

test("quota freeze blocks all odds tiers; critical drops cold/warm", () => {
  assert.equal(allowOddsTier("freeze", "hot"), false);
  assert.equal(allowOddsTier("critical", "cold"), false);
  assert.equal(allowOddsTier("critical", "hot"), true);
  assert.equal(allowOddsTier("normal", "cold"), true);
});

test("public queries exclude oddspapi by default", () => {
  const where = andNotOddspapi({ status: "NS" });
  assert.equal(where.AND[1].provider.not, PROVIDER_ODDSPAPI);
});

test("mergeBookmakerOdds keeps earlier prices when a later patch has no markets", () => {
  const seeded = {
    "1xbet": {
      markets: {
        101: {
          outcomes: {
            101: { players: { 0: { price: 1.9 } } },
          },
        },
      },
    },
  };
  const infoOnly = {
    "1xbet": { fixturePath: "https://example/match" },
  };
  const merged = mergeBookmakerOdds(seeded, infoOnly);
  assert.equal(merged["1xbet"].fixturePath, "https://example/match");
  assert.equal(merged["1xbet"].markets[101].outcomes[101].players[0].price, 1.9);
});

test("mergeBookmakerOdds deep-merges a single outcome delta", () => {
  const prev = {
    "1xbet": {
      markets: {
        101: {
          outcomes: {
            101: { players: { 0: { price: 1.9, active: true } } },
            102: { players: { 0: { price: 3.4, active: true } } },
          },
        },
      },
    },
  };
  const patch = {
    "1xbet": {
      markets: {
        101: {
          outcomes: {
            101: { players: { 0: { price: 2.05 } } },
          },
        },
      },
    },
  };
  const merged = mergeBookmakerOdds(prev, patch);
  assert.equal(merged["1xbet"].markets[101].outcomes[101].players[0].price, 2.05);
  assert.equal(merged["1xbet"].markets[101].outcomes[102].players[0].price, 3.4);
});

test("mergeScorePeriods keeps p1 when a later frame only has result", () => {
  const seeded = {
    scores: {
      periods: {
        p1: {
          participant1Score: 1,
          participant2Score: 0,
          startedAt: "2026-09-01T14:00:00Z",
        },
      },
    },
  };
  const delta = {
    scores: {
      periods: {
        result: {
          participant1Score: 2,
          participant2Score: 0,
          startedAt: "2026-09-01T14:00:00Z",
        },
      },
    },
  };
  const merged = mergeScorePeriods(seeded, delta);
  assert.equal(merged.periods.p1.participant1Score, 1);
  assert.equal(merged.periods.result.participant1Score, 2);
});
