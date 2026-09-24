import { describe, expect, it } from "vitest";
import { homeCategoryTiles, topNavItems } from "./homepageData.js";

describe("games lists", () => {
  it("exposes MichuBet-matching header game shortcuts and MORE lobby", () => {
    expect(topNavItems.map((item) => item.id)).toEqual([
      "home",
      "chickenRoad",
      "chickenCoin",
      "aviator",
      "bingo",
      "megaBlock",
      "fastKeno",
      "games",
    ]);
    expect(topNavItems.find((item) => item.id === "games").path).toBe("/casino");
    expect(
      topNavItems.find((item) => item.id === "chickenRoad").launch,
    ).toBe("chicken-road-two-bonus");
  });

  it("exposes home tile list including InOut, MRX, and All games", () => {
    expect(homeCategoryTiles.map((tile) => tile.id)).toEqual([
      "inout",
      "chickenRoad",
      "chickenCoin",
      "aviator",
      "bingo",
      "megaBlock",
      "fastKeno",
      "allGames",
    ]);
    expect(homeCategoryTiles.find((tile) => tile.id === "allGames").path).toBe(
      "/casino",
    );
  });
});
