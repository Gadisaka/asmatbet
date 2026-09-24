import { describe, expect, it } from "vitest";
import { MOCK_INOUT_GAMES } from "./mockGames.js";
import { toPublicFixture } from "../../server/oddspapiFeed.js";

describe("mock inout cards", () => {
  it("builds poster cards", () => {
    expect(MOCK_INOUT_GAMES.length).toBeGreaterThanOrEqual(24);
    for (const game of MOCK_INOUT_GAMES) {
      expect(game.title.length).toBeGreaterThan(0);
      expect(game.iconUrl.startsWith("data:image/svg+xml")).toBe(true);
      expect(game.mock).toBe(true);
    }
  });
});

describe("oddspapi fixture mapping", () => {
  it("maps a provider fixture into the sportsbook row shape", () => {
    const row = toPublicFixture({
      fixtureId: "id1000001761301153",
      statusId: 0,
      startTime: "2026-09-24T18:00:00.000Z",
      participant1Name: "Arsenal",
      participant2Name: "Chelsea",
      tournamentId: 17,
      tournamentName: "Premier League",
      categoryName: "England",
      categorySlug: "england",
    });
    expect(row.api_fixture_id).toBe(1000001761301153);
    expect(row.status).toBe("NS");
    expect(row.home_team.name).toBe("Arsenal");
    expect(row.away_team.name).toBe("Chelsea");
    expect(row.league.country).toBe("England");
    expect(row.league.name).toBe("Premier League");
    expect(row.league.country_flag).toContain("gb-eng");
    expect(row.start_time).toBe("2026-09-24T18:00:00.000Z");
  });
});
