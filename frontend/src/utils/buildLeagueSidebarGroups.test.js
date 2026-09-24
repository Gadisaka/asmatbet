import { describe, expect, it } from "vitest";
import { buildLeagueSidebarGroups } from "./buildLeagueSidebarGroups.js";

describe("buildLeagueSidebarGroups coming-game counts", () => {
  it("includes top-section leagues in country totals", () => {
    const catalogItems = [
      {
        id: "England - Premier League",
        label: "Premier League",
        section: "top",
        rank: 1,
        count: 40,
      },
      {
        id: "England - Championship",
        label: "Championship",
        section: "regional",
        rank: 20,
        count: 30,
      },
    ];
    const counts = new Map([
      ["England - Premier League", 40],
      ["England - Championship", 30],
    ]);

    const { countryGroups } = buildLeagueSidebarGroups(
      catalogItems,
      counts,
      new Map(),
    );

    const england = countryGroups.find((g) => g.country === "England");
    expect(england).toBeTruthy();
    expect(england.matchCount).toBe(70);
    expect(england.leagues.map((l) => l.id)).toEqual([
      "England - Premier League",
      "England - Championship",
    ]);
  });

  it("uses catalog counts over empty client data", () => {
    const catalogItems = [
      {
        id: "Spain - La Liga",
        label: "La Liga",
        section: "regional",
        rank: 2,
      },
    ];
    const counts = new Map([["Spain - La Liga", 43]]);

    const { countryGroups } = buildLeagueSidebarGroups(
      catalogItems,
      counts,
      new Map(),
    );

    const spain = countryGroups.find((g) => g.country === "Spain");
    expect(spain.matchCount).toBe(43);
    expect(spain.leagues[0].count).toBe(43);
  });
});
