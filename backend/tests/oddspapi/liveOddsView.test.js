import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateLine,
  isLiveLineMissingRequiredTimestamp,
  isPriceStale,
} from "../../services/providers/oddspapi/liveOddsView.js";
import {
  collapseOddLinesByValue,
  legacyMarketsFromLines,
} from "../../services/providers/oddspapi/marketBridge.js";

test("isPriceStale is true when the 1X2 changed before the last score", () => {
  assert.equal(
    isPriceStale("2026-09-01T18:00:00.000Z", "2026-09-01T18:12:00.000Z"),
    true,
  );
  assert.equal(
    isPriceStale("2026-09-01T18:12:00.000Z", "2026-09-01T18:00:00.000Z"),
    false,
  );
  assert.equal(isPriceStale(null, "2026-09-01T18:00:00.000Z"), false);
  assert.equal(isPriceStale("2026-09-01T18:00:00.000Z", null), false);
});

test("legacyMarketsFromLines carries active/suspended from the line and book", () => {
  const markets = legacyMarketsFromLines(
    [
      {
        marketId: 101,
        outcomeId: 101,
        price: 4.61,
        active: false,
        changedAt: "2026-09-01T18:00:00.000Z",
      },
    ],
    {
      101: {
        marketId: 101,
        marketName: "Full Time Result",
        marketType: "1x2",
        period: "fulltime",
        outcomes: { 101: "1" },
      },
    },
  );
  assert.equal(markets[0].name, "Match Winner");
  assert.equal(markets[0].odd_lines[0].active, false);
  assert.equal(markets[0].odd_lines[0].suspended, true);
  assert.equal(markets[0].odd_lines[0].changed_at, "2026-09-01T18:00:00.000Z");

  const bookDown = legacyMarketsFromLines(
    [
      {
        marketId: 101,
        outcomeId: 101,
        price: 1.9,
        active: true,
      },
    ],
    {
      101: {
        marketType: "1x2",
        period: "fulltime",
        outcomes: { 101: "1" },
      },
    },
    { bookSuspended: true },
  );
  assert.equal(bookDown[0].odd_lines[0].suspended, true);
});

test("collapseOddLinesByValue keeps the newest changed_at", () => {
  const kept = collapseOddLinesByValue([
    { value: "Home", odd: 9.5, active: true, changed_at: "2026-09-01T18:00:00.000Z" },
    { value: "Home", odd: 1.002, active: false, changed_at: "2026-09-01T18:12:00.000Z" },
    { value: "Draw", odd: 5.1, active: true, changed_at: null },
  ]);
  assert.equal(kept.length, 2);
  const home = kept.find((ol) => ol.value === "Home");
  assert.equal(home.odd, 1.002);
  assert.equal(home.active, false);
});

test("collapseOddLinesByValue treats a missing timestamp as oldest", () => {
  const kept = collapseOddLinesByValue([
    { value: "Home", odd: 9.5, active: true, changed_at: null },
    { value: "Home", odd: 1.002, active: false, changed_at: "2026-09-01T18:12:00.000Z" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].odd, 1.002);
});

test("legacyMarketsFromLines collapses duplicate values to the newest line", () => {
  const markets = legacyMarketsFromLines(
    [
      {
        marketId: 101,
        outcomeId: 101,
        price: 9.5,
        active: true,
        changedAt: "2026-09-01T18:00:00.000Z",
      },
      {
        marketId: 101,
        outcomeId: 101,
        price: 1.002,
        active: false,
        changedAt: "2026-09-01T18:12:00.000Z",
      },
    ],
    {
      101: {
        marketType: "1x2",
        period: "fulltime",
        outcomes: { 101: "1" },
      },
    },
  );
  assert.equal(markets[0].odd_lines.length, 1);
  assert.equal(markets[0].odd_lines[0].odd, 1.002);
  assert.equal(markets[0].odd_lines[0].active, false);
});

test("annotateLine suspends a null changed_at 1X2 when LIVE_REQUIRE_PRICE_TIMESTAMP=1", () => {
  const prev = process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
  process.env.LIVE_REQUIRE_PRICE_TIMESTAMP = "1";
  try {
    assert.equal(
      isLiveLineMissingRequiredTimestamp({
        changedAt: null,
        marketName: "Match Winner",
        fixtureStatus: "LIVE",
      }),
      true,
    );
    const line = annotateLine(
      { value: "Home", odd: 9.5, active: true, changed_at: null },
      { marketName: "Match Winner", fixtureStatus: "LIVE" },
    );
    assert.equal(line.suspended, true);
  } finally {
    if (prev == null) delete process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
    else process.env.LIVE_REQUIRE_PRICE_TIMESTAMP = prev;
  }
});

test("annotateLine leaves a null changed_at 1X2 open when the flag is off", () => {
  const prev = process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
  delete process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
  try {
    const line = annotateLine(
      { value: "Home", odd: 9.5, active: true, changed_at: null },
      { marketName: "Match Winner", fixtureStatus: "LIVE" },
    );
    assert.equal(line.suspended, false);
  } finally {
    if (prev == null) delete process.env.LIVE_REQUIRE_PRICE_TIMESTAMP;
    else process.env.LIVE_REQUIRE_PRICE_TIMESTAMP = prev;
  }
});
