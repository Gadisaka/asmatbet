import test from "node:test";
import assert from "node:assert/strict";
import {
  isFullyUndecided,
  lookupTicketResult,
  normalizeSettlements,
  outcomeKey,
  toTicketResult,
} from "../../services/providers/oddspapi/settlement.js";
import {
  bridgeSelection,
  familyKey,
  isBridgeable,
  publicMarket,
  legacyMarket,
  LEGACY_MARKET_NAMES,
} from "../../services/providers/oddspapi/marketBridge.js";
import {
  normalizeScores,
  settlementScorePatch,
} from "../../services/providers/oddspapi/normalize.js";
import { evaluateSelection } from "../../services/marketEvaluatorV2.js";

/** Trimmed from a real `/v4/settlements` response for a 0-0 fixture. */
const SETTLEMENTS = {
  fixtureId: "id1000023174068586",
  markets: {
    101: {
      outcomes: {
        101: { players: { 0: { result: "LOSE" } } },
        102: { players: { 0: { result: "WIN" } } },
        103: { players: { 0: { result: "LOSE" } } },
      },
    },
    106: {
      outcomes: {
        106: { players: { 0: { result: "LOSE" } } },
        107: { players: { 0: { result: "WIN" } } },
      },
    },
    10214: {
      outcomes: {
        10214: { players: { 0: { result: "PUSH" } } },
        10215: { players: { 0: { result: "PUSH" } } },
      },
    },
    1070: {
      outcomes: {
        1070: { players: { 0: { result: "HALFWIN" } } },
        1071: { players: { 0: { result: "HALFLOSS" } } },
      },
    },
    99999: {
      outcomes: { 99999: { players: { 0: { result: "UNDECIDED" } } } },
    },
  },
};

/** Catalogue slice matching the market ids above. */
const CATALOGUE = {
  101: {
    marketName: "Full Time Result",
    marketType: "1x2",
    period: "fulltime",
    handicap: 0,
    playerProp: false,
    outcomes: { 101: "1", 102: "X", 103: "2" },
  },
  104: {
    marketName: "Both Teams To Score",
    marketType: "bothteamsscore",
    period: "fulltime",
    handicap: 0,
    playerProp: false,
    outcomes: { 104: "Yes", 105: "No" },
  },
  106: {
    marketName: "Over Under Full Time",
    marketType: "totals",
    period: "fulltime",
    handicap: 0.5,
    playerProp: false,
    outcomes: { 106: "Over", 107: "Under" },
  },
  10214: {
    marketName: "Draw No Bet",
    marketType: "drawnobet",
    period: "fulltime",
    handicap: 0,
    playerProp: false,
    outcomes: { 10214: "1", 10215: "2" },
  },
  101902: {
    marketName: "Double Chance Full Time",
    marketType: "doublechance",
    period: "fulltime",
    handicap: 0,
    playerProp: false,
    outcomes: { 101902: "1X", 101903: "12", 101904: "X2" },
  },
  1070: {
    marketName: "Asian Handicap",
    marketType: "spreads",
    period: "fulltime",
    handicap: -0.25,
    playerProp: false,
    outcomes: { 1070: "1", 1071: "2" },
  },
  10730: {
    marketName: "Anytime Goal Scorer",
    marketType: "players-anytimegoalscorer",
    period: "fulltime",
    handicap: 0,
    playerProp: true,
    outcomes: { 10730: "Yes" },
  },
};

test("toTicketResult maps every documented provider verdict", () => {
  assert.deepEqual(toTicketResult("WIN"), { result: "WON", factor: 1 });
  assert.deepEqual(toTicketResult("LOSE"), { result: "LOST", factor: 1 });
  assert.deepEqual(toTicketResult("HALFWIN"), { result: "WON", factor: 0.5 });
  assert.deepEqual(toTicketResult("HALFLOSS"), { result: "LOST", factor: 0.5 });
  assert.deepEqual(toTicketResult("PUSH"), { result: "VOID", factor: 0 });
  assert.deepEqual(toTicketResult("CANCELLED"), { result: "VOID", factor: 0 });
  assert.deepEqual(toTicketResult("UNDECIDED"), { result: "PENDING", factor: 0 });
});

test("an unknown verdict never invents a payout", () => {
  const r = toTicketResult("SOMETHING_NEW");
  assert.equal(r.result, "PENDING");
  assert.equal(r.unknown, true);
});

test("normalizeSettlements flattens the tree and drops UNDECIDED filler", () => {
  const { fixtureId, byKey, counts } = normalizeSettlements(SETTLEMENTS);
  assert.equal(fixtureId, "id1000023174068586");
  assert.equal(counts.UNDECIDED, 1);
  assert.equal(byKey.has(outcomeKey(99999, 99999, 0)), false);

  const draw = byKey.get(outcomeKey(101, 102, 0));
  assert.equal(draw.result, "WON");
  assert.equal(draw.providerResult, "WIN");
});

test("normalizeSettlements can retain UNDECIDED when asked", () => {
  const { byKey } = normalizeSettlements(SETTLEMENTS, { includeUndecided: true });
  assert.equal(byKey.get(outcomeKey(99999, 99999, 0)).result, "PENDING");
});

test("normalizeSettlements tolerates a malformed payload", () => {
  for (const bad of [null, {}, { markets: null }, { markets: { 1: {} } }]) {
    const { byKey } = normalizeSettlements(bad);
    assert.equal(byKey.size, 0);
  }
});

test("isFullyUndecided detects an ungraded fixture", () => {
  assert.equal(isFullyUndecided({ UNDECIDED: 1622 }), true);
  assert.equal(isFullyUndecided({ UNDECIDED: 1622, WIN: 1 }), false);
  assert.equal(isFullyUndecided({}), true);
});

test("lookupTicketResult maps a settled outcome including half-stake", () => {
  const { byKey } = normalizeSettlements(SETTLEMENTS);
  assert.equal(lookupTicketResult(byKey, 101, 102).result, "WON");
  assert.equal(lookupTicketResult(byKey, 101, 101).result, "LOST");
  const halfWin = lookupTicketResult(byKey, 1070, 1070);
  assert.equal(halfWin.result, "WON");
  assert.equal(halfWin.factor, 0.5);
  assert.equal(halfWin.reason, "oddspapi:HALFWIN");
  const halfLoss = lookupTicketResult(byKey, 1070, 1071);
  assert.equal(halfLoss.result, "LOST");
  assert.equal(halfLoss.factor, 0.5);
  assert.equal(lookupTicketResult(byKey, 999, 999).result, "PENDING");
  assert.equal(lookupTicketResult(byKey, null, 101).reason, "missing_provider_ids");
});

test("bridge maps the core score-derived markets", () => {
  assert.deepEqual(bridgeSelection(101, 102, CATALOGUE[101]), {
    market_code: "MATCH_WINNER",
    selection: "X",
    params: { side: "DRAW" },
  });
  assert.deepEqual(bridgeSelection(104, 104, CATALOGUE[104]), {
    market_code: "BTTS",
    selection: "YES",
    params: { pick: "YES" },
  });
  assert.deepEqual(bridgeSelection(106, 107, CATALOGUE[106]), {
    market_code: "OVER_UNDER",
    selection: "Under 0.5",
    params: { side: "UNDER", line: 0.5 },
  });
  assert.deepEqual(bridgeSelection(101902, 101904, CATALOGUE[101902]), {
    market_code: "DOUBLE_CHANCE",
    selection: "X2",
    params: { combination: "X2" },
  });
  assert.deepEqual(bridgeSelection(10214, 10215, CATALOGUE[10214]), {
    market_code: "DRAW_NO_BET",
    selection: "2",
    params: { side: "AWAY" },
  });
});

test("bridge maps asian handicap and still skips player props", () => {
  assert.deepEqual(bridgeSelection(1070, 1070, CATALOGUE[1070]), {
    market_code: "HANDICAP_ASIAN",
    selection: "1",
    params: { side: "HOME", handicap: -0.25 },
  });
  assert.equal(isBridgeable(1070, CATALOGUE[1070]), true);
  assert.equal(bridgeSelection(10730, 10730, CATALOGUE[10730]), null);
  assert.equal(isBridgeable(10730, CATALOGUE[10730]), false);
});

test("bridge special-cases market 104, whose catalogue marketType varies", () => {
  assert.equal(familyKey(104, { marketType: "totals", period: "fulltime" }), "bothteamsscore|fulltime");
});

test("bridge returns null for an outcome id missing from the catalogue", () => {
  assert.equal(bridgeSelection(101, 999, CATALOGUE[101]), null);
  assert.equal(bridgeSelection(101, 102, undefined), null);
});

test("legacyMarket emits the exact API-Football storage strings", () => {
  assert.deepEqual(legacyMarket(101, 101, CATALOGUE[101]), {
    market_code: "MATCH_WINNER",
    selection: "1",
    params: { side: "HOME" },
    name: "Match Winner",
    value: "Home",
  });
  assert.deepEqual(legacyMarket(101, 102, CATALOGUE[101]), {
    market_code: "MATCH_WINNER",
    selection: "X",
    params: { side: "DRAW" },
    name: "Match Winner",
    value: "Draw",
  });
  assert.deepEqual(legacyMarket(101, 103, CATALOGUE[101]), {
    market_code: "MATCH_WINNER",
    selection: "2",
    params: { side: "AWAY" },
    name: "Match Winner",
    value: "Away",
  });
  assert.deepEqual(legacyMarket(101902, 101902, CATALOGUE[101902]), {
    market_code: "DOUBLE_CHANCE",
    selection: "1X",
    params: { combination: "1X" },
    name: "Double Chance",
    value: "Home/Draw",
  });
  assert.deepEqual(legacyMarket(101902, 101903, CATALOGUE[101902]), {
    market_code: "DOUBLE_CHANCE",
    selection: "12",
    params: { combination: "12" },
    name: "Double Chance",
    value: "Home/Away",
  });
  assert.deepEqual(legacyMarket(101902, 101904, CATALOGUE[101902]), {
    market_code: "DOUBLE_CHANCE",
    selection: "X2",
    params: { combination: "X2" },
    name: "Double Chance",
    value: "Draw/Away",
  });
  assert.deepEqual(legacyMarket(104, 104, CATALOGUE[104]), {
    market_code: "BTTS",
    selection: "YES",
    params: { pick: "YES" },
    name: "Both Teams Score",
    value: "Yes",
  });
  assert.deepEqual(legacyMarket(104, 105, CATALOGUE[104]), {
    market_code: "BTTS",
    selection: "NO",
    params: { pick: "NO" },
    name: "Both Teams Score",
    value: "No",
  });
  assert.deepEqual(legacyMarket(106, 106, CATALOGUE[106]), {
    market_code: "OVER_UNDER",
    selection: "Over 0.5",
    params: { side: "OVER", line: 0.5 },
    name: "Goals Over/Under",
    value: "Over 0.5",
  });
  assert.deepEqual(legacyMarket(106, 107, CATALOGUE[106]), {
    market_code: "OVER_UNDER",
    selection: "Under 0.5",
    params: { side: "UNDER", line: 0.5 },
    name: "Goals Over/Under",
    value: "Under 0.5",
  });
});

test("legacyMarket names match the public list allowlist byte-for-byte", () => {
  const offered = new Set(Object.values(LEGACY_MARKET_NAMES));
  for (const name of ["Match Winner", "Double Chance", "Both Teams Score", "Goals Over/Under"]) {
    assert.equal(offered.has(name), true, name);
  }
});

test("publicMarket persists quarter-line totals and asian handicap", () => {
  const cat = {
    ...CATALOGUE[106],
    handicap: 0.75,
  };
  const ou = publicMarket(106, 106, cat);
  assert.equal(ou.name, "Goals Over/Under");
  assert.equal(ou.value, "Over 0.75");
  const ah = publicMarket(1070, 1070, CATALOGUE[1070]);
  assert.equal(ah.name, "Asian Handicap");
  assert.equal(ah.value, "Home -0.25");
  const ahAway = publicMarket(1070, 1071, CATALOGUE[1070]);
  assert.equal(ahAway.value, "Away +0.25");
});

test("publicMarket maps HT 1x2 and falls back to catalogue names", () => {
  const ht = publicMarket(201, 201, {
    marketName: "First Half Result",
    marketType: "1x2",
    period: "p1",
    handicap: 0,
    playerProp: false,
    outcomes: { 201: "1", 202: "X", 203: "2" },
  });
  assert.equal(ht.name, "First Half Winner");
  assert.equal(ht.value, "Home");
  const unknown = publicMarket(888, 1, {
    marketName: "Method of Victory",
    marketType: "method",
    period: "fulltime",
    handicap: 0,
    playerProp: false,
    outcomes: { 1: "Regular Time" },
  });
  assert.equal(unknown.name, "Method of Victory");
  assert.equal(unknown.value, "Regular Time");
  assert.equal(unknown.market_code, null);
});

test("publicMarket encodes player props in the line value", () => {
  const mapped = publicMarket(
    10730,
    10730,
    CATALOGUE[10730],
    { playerId: 42, playerName: "Haaland" },
  );
  assert.equal(mapped.name, "Anytime Goal Scorer");
  assert.equal(mapped.value, "Haaland - Yes");
});

test("publicMarket keeps team totals off the match OU name", () => {
  const home = publicMarket(2001, 1, {
    marketName: "Home Team Total",
    marketType: "totals",
    period: "fulltime",
    handicap: 1.5,
    playerProp: false,
    outcomes: { 1: "Over", 2: "Under" },
  });
  assert.equal(home.name, "Total - Home");
  assert.equal(home.value, "Over 1.5");
  assert.equal(home.market_code, "TEAM_TOTAL_HOME");
  const ht = publicMarket(2002, 1, {
    marketName: "Home Team Total First Half",
    marketType: "totals",
    period: "p1",
    handicap: 0.5,
    playerProp: false,
    outcomes: { 1: "Over", 2: "Under" },
  });
  assert.equal(ht.name, "Home Team Total Goals(1st Half)");
  assert.equal(ht.value, "Over 0.5");
});

test("normalizeScores reads NAMED periods, not positional ones", () => {
  const raw = {
    scores: {
      periods: {
        result: { participant1Score: 2, participant2Score: 2 },
        p1: { participant1Score: 1, participant2Score: 0 },
        fulltime: { participant1Score: 1, participant2Score: 1 },
      },
    },
  };
  const s = normalizeScores(raw);
  assert.deepEqual(s.fullTime, { home: 1, away: 1 });
  assert.deepEqual(s.halfTime, { home: 1, away: 0 });
  // `result` includes overtime and must stay distinct from full time.
  assert.deepEqual(s.result, { home: 2, away: 2 });
});

test("normalizeScores returns nulls rather than guessing", () => {
  assert.deepEqual(normalizeScores(null).fullTime, null);
  assert.deepEqual(normalizeScores({ scores: { periods: {} } }).fullTime, null);
});

test("normalizeScores reads a live-only result period", () => {
  const s = normalizeScores({
    scores: {
      periods: {
        result: {
          participant1Score: 2,
          participant2Score: 0,
          startedAt: "2026-09-01T14:00:05+00:00",
        },
      },
    },
  });
  assert.deepEqual(s.fullTime, null);
  assert.deepEqual(s.halfTime, null);
  assert.deepEqual(s.result, { home: 2, away: 0 });
  assert.equal(s.periods.result.startedAt, "2026-09-01T14:00:05+00:00");
});

test("settlementScorePatch uses fulltime, never result", () => {
  const scored = normalizeScores({
    scores: {
      periods: {
        result: { participant1Score: 3, participant2Score: 2 },
        p1: { participant1Score: 1, participant2Score: 0 },
        fulltime: { participant1Score: 2, participant2Score: 1 },
      },
    },
  });
  assert.deepEqual(settlementScorePatch(scored), {
    home_score: 2,
    away_score: 1,
    ht_home_score: 1,
    ht_away_score: 0,
  });
});

test("provider verdicts agree with our grader on a real 0-0 fixture", () => {
  const matchResult = {
    finality: "FINAL",
    status: "FT",
    scores: { fullTime: { home: 0, away: 0 }, halfTime: { home: 0, away: 0 } },
  };
  const { byKey } = normalizeSettlements(SETTLEMENTS);

  let compared = 0;
  for (const entry of byKey.values()) {
    if (entry.factor === 0.5) continue;
    const bridged = bridgeSelection(entry.marketId, entry.outcomeId, CATALOGUE[entry.marketId]);
    if (!bridged) continue;
    const ours = evaluateSelection(
      { market_code: bridged.market_code, selection: bridged.selection, params: bridged.params },
      matchResult,
    );
    assert.equal(
      ours.result,
      entry.result,
      `${bridged.market_code} ${bridged.selection}: ours=${ours.result} provider=${entry.result}`,
    );
    compared += 1;
  }
  assert.ok(compared >= 7, `expected to compare the whole slice, got ${compared}`);
});
