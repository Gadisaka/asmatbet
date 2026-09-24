import { describe, expect, it } from "vitest";
import {
  MIN_MULTIPLE_CARDS,
  buildMultipleOfTheDayTickets,
  ticketToSlipSelections,
} from "./multipleOfTheDay.js";

const NOW = new Date("2026-09-03T08:00:00.000Z");

function match({
  id,
  home,
  away,
  kickoffAt,
  leagueRank = 10,
  sportId = "football",
  status = "NS",
  homeOdd = "1.55",
  awayOdd = "5.20",
  drawOdd = "3.80",
  dc1x = "1.28",
  dc12 = "1.22",
  bttsYes = "1.72",
  over25 = "1.68",
  under25 = "1.85",
  extras = true,
} = {}) {
  const row = {
    id: `fx-${id}`,
    apiFixtureId: id,
    sportId,
    status,
    leagueRank,
    league: "England - Premier League",
    match: `${home} V ${away}`,
    homeTeam: home,
    awayTeam: away,
    kickoffAt,
    markets: [
      { id: "1", value: homeOdd },
      { id: "x", value: drawOdd },
      { id: "2", value: awayOdd },
      { id: "1x", value: dc1x },
      { id: "12", value: dc12 },
      { id: "x2", value: "1.95" },
    ],
    detailedOdds: { main: [], extra: [] },
  };
  if (extras) {
    row.detailedOdds.extra = [
      {
        category: "Both Teams Score",
        odds: [
          { id: "Yes", value: bttsYes },
          { id: "No", value: "2.05" },
        ],
      },
      {
        category: "Goals Over/Under",
        odds: [
          { id: "Over 2.5", value: over25 },
          { id: "Under 2.5", value: under25 },
        ],
      },
    ];
  }
  return row;
}

function upcoming(id, home, extra = {}) {
  const hour = 12 + (id % 8);
  return match({
    id,
    home,
    away: `Away ${id}`,
    kickoffAt: `2026-09-03T${String(hour).padStart(2, "0")}:00:00.000Z`,
    ...extra,
  });
}

describe("buildMultipleOfTheDayTickets", () => {
  it("returns no tickets when fewer than three priced football matches remain", () => {
    expect(
      buildMultipleOfTheDayTickets(
        [upcoming(1, "Arsenal"), upcoming(2, "Liverpool")],
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it("skips live, finished, non-football, and kicked-off matches", () => {
    const pool = [
      upcoming(1, "Arsenal"),
      upcoming(2, "Liverpool", { status: "LIVE" }),
      upcoming(3, "Chelsea", { sportId: "tennis" }),
      upcoming(4, "Spurs", { kickoffAt: "2026-09-03T07:00:00.000Z" }),
      upcoming(5, "City"),
      upcoming(6, "United"),
    ];
    const tickets = buildMultipleOfTheDayTickets(pool, { now: NOW });
    const result = tickets.find((t) => t.id === "mod-match-result");
    expect(result.legs.map((leg) => leg.matchName)).toEqual([
      "Arsenal V Away 1",
      "City V Away 5",
      "United V Away 6",
    ]);
  });

  it("builds at least six mixed-market cards from live prices", () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      upcoming(i + 1, `Home ${i + 1}`, { leagueRank: i + 1 }),
    );
    const tickets = buildMultipleOfTheDayTickets(pool, {
      now: NOW,
      bonuses: [
        {
          type: "ACCUMULATOR",
          rules: { tiers: [{ minLegs: 5, bonusPercent: 10 }] },
        },
      ],
    });

    expect(tickets.length).toBeGreaterThanOrEqual(MIN_MULTIPLE_CARDS);
    expect(tickets.map((t) => t.id)).toEqual(
      expect.arrayContaining([
        "mod-match-result",
        "mod-double-chance",
        "mod-btts",
        "mod-over-25",
        "mod-mixed",
        "mod-under-25",
      ]),
    );
    expect(tickets[0].bonusPercent).toBe(10);

    const mixed = tickets.find((t) => t.id === "mod-mixed");
    const mixedCodes = new Set(mixed.legs.map((leg) => leg.marketCode));
    expect(mixedCodes.size).toBeGreaterThan(1);
  });

  it("maps a BTTS ticket onto slip selections the place-bet API can send", () => {
    const tickets = buildMultipleOfTheDayTickets(
      [upcoming(1, "Arsenal"), upcoming(2, "Liverpool"), upcoming(3, "City")],
      { now: NOW },
    );
    const btts = tickets.find((t) => t.id === "mod-btts");
    const selections = ticketToSlipSelections(btts);
    expect(selections[0]).toMatchObject({
      apiFixtureId: 1,
      marketCode: "BTTS",
      marketParams: { pick: "YES" },
      label: "YES",
      fromLive: false,
    });
  });
});
