import { describe, expect, it } from "vitest";
import {
  filterCategoriesByChipId,
  getTabsForMarketName,
  MARKET_FILTER_ALL_CHIP_ID,
  MARKET_FILTER_CHIPS,
  MARKET_FILTER_TAB_LABEL,
} from "./footballMarketsByCategory.js";

describe("getTabsForMarketName", () => {
  it("maps Match Winner to main-market", () => {
    expect(getTabsForMarketName("Match Winner").has("main-market")).toBe(true);
  });

  it("maps Fulltime Result alias to main-market via catalog", () => {
    expect(getTabsForMarketName("fulltime result").has("main-market")).toBe(
      true,
    );
  });

  it("maps Both Teams Score to main-market", () => {
    expect(getTabsForMarketName("Both Teams Score").has("main-market")).toBe(
      true,
    );
    expect(getTabsForMarketName("Both Teams to Score").has("main-market")).toBe(
      true,
    );
  });

  it("maps Goals Over/Under to goals tab", () => {
    expect(getTabsForMarketName("Goals Over/Under").has("goals")).toBe(true);
  });

  it("maps Asian Handicap to main-market and handicaps", () => {
    const tabs = getTabsForMarketName("Asian Handicap");
    expect(tabs.has("main-market")).toBe(true);
    expect(tabs.has("handicaps")).toBe(true);
  });

  it("returns empty set for unknown labels", () => {
    expect(getTabsForMarketName("Completely Unknown Market XYZ").size).toBe(0);
  });
});

describe("filter chips", () => {
  it("labels the goals tab as Total", () => {
    expect(MARKET_FILTER_TAB_LABEL.goals).toBe("Total");
    expect(
      MARKET_FILTER_CHIPS.find((c) => c.id === "goals")?.label,
    ).toBe("Total");
  });
});

describe("filterCategoriesByChipId", () => {
  const cats = [
    { category: "Match Winner", odds: [] },
    { category: "Goals Over/Under", odds: [] },
    { category: "Niche Unknown Prop", odds: [] },
  ];

  it("returns all categories for All chip", () => {
    expect(filterCategoriesByChipId(cats, MARKET_FILTER_ALL_CHIP_ID)).toEqual(
      cats,
    );
  });

  it("filters by tab id", () => {
    expect(filterCategoriesByChipId(cats, "goals")).toEqual([
      { category: "Goals Over/Under", odds: [] },
    ]);
  });

  it("includes BTTS under Main Market", () => {
    const withBtts = [
      ...cats,
      { category: "Both Teams Score", odds: [] },
    ];
    expect(
      filterCategoriesByChipId(withBtts, "main-market").map((c) => c.category),
    ).toEqual(["Match Winner", "Both Teams Score"]);
  });

  it("returns empty array for non-all when nothing matches", () => {
    expect(filterCategoriesByChipId(cats, "yellow-cards")).toEqual([]);
  });
});
