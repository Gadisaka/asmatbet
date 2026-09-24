import { describe, expect, it } from "vitest";
import { applyOddsToMatch, mapFixtureToMatch } from "./fixtureMapper.js";

describe("mapFixtureToMatch summary strip", () => {
  const baseFx = () => ({
    api_fixture_id: 1378214,
    start_time: new Date("2026-05-09T14:00:00.000Z").toISOString(),
    status: "NS",
    home_team: { name: "Cagliari", logo: null },
    away_team: { name: "Udinese", logo: null },
    league: { name: "Serie A", country: "Italy", sport: "Football" },
  });

  it("maps league rank from fixture payload", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      league: {
        name: "Premier League",
        country: "Ethiopia",
        sport: "Football",
        api_league_id: 363,
        rank: 9,
      },
    });
    expect(match.leagueRank).toBe(9);
    expect(match.apiLeagueId).toBe(363);
  });

  it("uses first duplicate Double Chance label like expanded panel", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      markets: [
        {
          name: "Double Chance",
          odd_lines: [
            { value: "Home or Draw", odd: 1.4 },
            { value: "Home or Draw", odd: 1.28 },
            { value: "Draw/Away", odd: 1.5 },
            { value: "Home/Away", odd: 1.36 },
          ],
        },
      ],
    });

    const byId = Object.fromEntries(
      match.markets.map(({ id, value }) => [id, value]),
    );
    expect(byId["1x"]).toBe("1.40");
    expect(byId.x2).toBe("1.50");
    expect(byId["12"]).toBe("1.36");
  });

  it("compact main-market Double Chance agrees with detailedOdds first-wins", () => {
    const fixture = {
      ...baseFx(),
      markets: [
        {
          name: "Double Chance",
          odd_lines: [
            { value: "1X", odd: 1.4 },
            { value: "1X", odd: 1.28 },
            { value: "X2", odd: 1.5 },
            { value: "12", odd: 1.36 },
          ],
        },
      ],
    };

    const match = mapFixtureToMatch(fixture);
    const dcDetailed = match.detailedOdds.main.find(
      (m) => m.category === "Double Chance",
    );
    expect(dcDetailed?.odds).toBeDefined();

    const fromStrip = Object.fromEntries(
      match.markets.map(({ id, value }) => [id, value]),
    );
    expect(fromStrip["1x"]).toBe("1.40");
    expect(fromStrip.x2).toBe("1.50");
    expect(fromStrip["12"]).toBe("1.36");
    expect(dcDetailed.odds.find((o) => String(o.id).toLowerCase() === "1x")?.value).toBe(
      "1.40",
    );
  });

  it("keeps HT/FT Home/Draw compounds (does not collapse to 1x)", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      markets: [
        {
          name: "HT/FT Double",
          odd_lines: [
            { value: "Home/Home", odd: 1.83 },
            { value: "Home/Draw", odd: 4.0 },
            { value: "Draw/Draw", odd: 8.0 },
            { value: "Away/Home", odd: 21.0 },
            { value: "Home/Away", odd: 9.0 },
            { value: "Draw/Away", odd: 11.0 },
          ],
        },
      ],
    });

    const htft = match.detailedOdds.extra.find(
      (m) => m.category === "HT/FT Double",
    );
    const ids = htft?.odds?.map((o) => o.id) ?? [];
    expect(ids).toContain("Home/Draw");
    expect(ids).toContain("Home/Away");
    expect(ids).toContain("Draw/Away");
    expect(ids).not.toContain("1x");
    expect(ids).not.toContain("12");
    expect(ids).not.toContain("x2");
  });

  it("applyOddsToMatch keeps list strip; detail drives expanded markets only", () => {
    const fixture = {
      ...baseFx(),
      markets: [
        {
          name: "Match Winner",
          odd_lines: [
            { value: "1", odd: 9.99 },
            { value: "Draw", odd: 8.88 },
            { value: "2", odd: 7.77 },
          ],
        },
        {
          name: "Double Chance",
          odd_lines: [
            { value: "1X", odd: 6.66 },
            { value: "X2", odd: 5.55 },
            { value: "12", odd: 4.44 },
          ],
        },
      ],
    };

    const listMatch = mapFixtureToMatch(fixture);

    const detailOddsPayload = {
      markets: [
        ...fixture.markets.map((m) =>
          m.name === "Double Chance"
            ? {
                ...m,
                odd_lines: [
                  { value: "1X", odd: 1.11 },
                  { value: "X2", odd: 2.22 },
                  { value: "12", odd: 3.33 },
                ],
              }
            : m,
        ),
        {
          name: "Goals Over/Under",
          odd_lines: [{ value: "Over 2.5", odd: 1.9 }],
        },
      ],
    };

    const merged = applyOddsToMatch(listMatch, detailOddsPayload);

    expect(merged.markets).toEqual(listMatch.markets);

    const dcMain = merged.detailedOdds.main.find(
      (x) => x.category === "Double Chance",
    );
    const dc1x = dcMain?.odds?.find((o) => String(o.id).toLowerCase() === "1x");
    expect(dc1x?.value).toBe("1.11");

    expect(merged.sideBets).toEqual(listMatch.sideBets);
  });

  it("counts priced odd cells from markets when no stored total exists", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      markets: [
        {
          name: "Match Winner",
          odd_lines: [
            { value: "1", odd: 2.1 },
            { value: "Draw", odd: 3.2 },
            { value: "2", odd: 4.3 },
          ],
        },
        {
          name: "Goals Over/Under",
          odd_lines: [
            { value: "Over 2.5", odd: 1.9 },
            { value: "Under 2.5", odd: 1.95 },
          ],
        },
      ],
    });

    expect(match.sideBets).toBe(5);
  });

  it("prefers stored available_odd_cells_count when list payload is summary-only", () => {
    const match = mapFixtureToMatch({
      ...baseFx(),
      available_odd_cells_count: 142,
      extra_markets_count: 98,
      markets: [
        {
          name: "Match Winner",
          odd_lines: [
            { value: "1", odd: 2.1 },
            { value: "Draw", odd: 3.2 },
            { value: "2", odd: 4.3 },
          ],
        },
        {
          name: "Double Chance",
          odd_lines: [
            { value: "1X", odd: 1.4 },
            { value: "X2", odd: 1.5 },
            { value: "12", odd: 1.6 },
          ],
        },
      ],
    });

    expect(match.sideBets).toBe(142);
  });
});
