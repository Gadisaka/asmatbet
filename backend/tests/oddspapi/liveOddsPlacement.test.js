import test from "node:test";
import assert from "node:assert/strict";
import { validatePlacementSelections } from "../../services/odds-engine/validateSelections.js";

function makePrisma({ fixtures = [], oddLines = [] }) {
  return {
    fixture: {
      findMany: async ({ where }) => {
        const ids = where?.api_fixture_id?.in || [];
        return fixtures.filter((f) => ids.includes(f.api_fixture_id));
      },
    },
    fixtureMarket: {
      findMany: async ({ where }) => {
        const fixtureId = where?.fixture_id;
        const names = where?.name?.in || [];
        const seen = new Set();
        const markets = [];
        for (const row of oddLines) {
          if (fixtureId && row.fixtureId !== fixtureId) continue;
          if (names.length && !names.includes(row.marketName)) continue;
          const id = `${row.fixtureId}:${row.marketName}`;
          if (seen.has(id)) continue;
          seen.add(id);
          markets.push({ id, name: row.marketName, fixture_id: row.fixtureId });
        }
        return markets;
      },
    },
    fixtureOddLine: {
      findMany: async ({ where }) => {
        const marketIds = where?.market_id?.in || [];
        const values = where?.value?.in || [];
        return oddLines
          .filter((row) => {
            const mid = `${row.fixtureId}:${row.marketName}`;
            if (marketIds.length && !marketIds.includes(mid)) return false;
            if (values.length && !values.includes(row.value)) return false;
            return true;
          })
          .map((row) => ({
            odd: row.odd,
            value: row.value,
            active: row.active,
            changed_at: row.changed_at || null,
            provider_market_id: row.provider_market_id ?? 101,
            provider_outcome_id: row.provider_outcome_id ?? 101,
            provider_player_id: row.provider_player_id ?? 0,
            market: { name: row.marketName, fixture_id: row.fixtureId },
            bookmaker: row.bookmaker || { api_bookmaker_id: 11 },
          }));
      },
    },
  };
}

test("inactive odd line is rejected as market_suspended", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "NS",
        start_time: new Date(Date.now() + 60_000),
        live_updated_at: null,
      },
    ],
    oddLines: [
      {
        fixtureId: "fx1",
        marketName: "Match Winner",
        value: "Home",
        odd: 4.61,
        active: false,
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        label: "Home",
        odds: 4.61,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "market_suspended");
});

test("1X2 older than live_updated_at is rejected as market_suspended", async () => {
  const prisma = makePrisma({
    fixtures: [
      {
        id: "fx1",
        api_fixture_id: 11,
        status: "LIVE",
        start_time: new Date(Date.now() + 60_000),
        live_updated_at: new Date("2026-09-01T18:12:00.000Z"),
      },
    ],
    oddLines: [
      {
        fixtureId: "fx1",
        marketName: "Match Winner",
        value: "Home",
        odd: 4.61,
        active: true,
        changed_at: new Date("2026-09-01T18:00:00.000Z"),
      },
    ],
  });

  const out = await validatePlacementSelections({
    prismaClient: prisma,
    rawSelections: [
      {
        apiFixtureId: 11,
        marketLabel: "Match Winner",
        label: "Home",
        odds: 4.61,
      },
    ],
    live: false,
  });

  assert.equal(out.ok, false);
  assert.equal(out.code, "market_suspended");
});

test("null changed_at 1X2 on a live fixture is rejected when LIVE_REQUIRE_PRICE_TIMESTAMP=1", async () => {
  const prev = process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
  process.env.LIVE_REQUIRE_PRICE_TIMESTAMP = "1";
  try {
    const prisma = makePrisma({
      fixtures: [
        {
          id: "fx1",
          api_fixture_id: 11,
          status: "LIVE",
          start_time: new Date(Date.now() + 60_000),
          live_updated_at: new Date("2026-09-01T18:12:00.000Z"),
        },
      ],
      oddLines: [
        {
          fixtureId: "fx1",
          marketName: "Match Winner",
          value: "Home",
          odd: 4.61,
          active: true,
          changed_at: null,
        },
      ],
    });

    const out = await validatePlacementSelections({
      prismaClient: prisma,
      rawSelections: [
        {
          apiFixtureId: 11,
          marketLabel: "Match Winner",
          label: "Home",
          odds: 4.61,
        },
      ],
      live: false,
    });

    assert.equal(out.ok, false);
    assert.equal(out.code, "market_suspended");
  } finally {
    if (prev == null) delete process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
    else process.env.LIVE_REQUIRE_PRICE_TIMESTAMP = prev;
  }
});
