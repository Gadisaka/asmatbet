/**
 * Bridge OddsPapi `(marketId, outcomeId)` pairs onto the selection shape our
 * grading engine understands (`market_code` + `params`), and onto the public
 * `FixtureMarket.name` / `FixtureOddLine.value` strings the frontend already
 * knows.
 *
 * Settlement for OddsPapi legs is `/v4/settlements` keyed by provider ids, so
 * unknown families are still persisted with the catalogue display name rather
 * than dropped. `bridgeSelection` returning null only means V2 cannot shadow
 * that market.
 *
 * Keyed on the catalogue's `marketType`/`period` rather than raw market ids,
 * because a single family (e.g. `totals|fulltime`) spans many ids that differ
 * only by `handicap`.
 */

function label(catalogue, outcomeId) {
  const name = catalogue?.outcomes?.[String(outcomeId)];
  return name == null ? "" : String(name).trim();
}

function side1x2(raw) {
  const key = String(raw || "").toUpperCase();
  if (key === "1") return "HOME";
  if (key === "X") return "DRAW";
  if (key === "2") return "AWAY";
  return null;
}

function overUnderSide(raw) {
  const key = String(raw || "").toUpperCase();
  if (key === "OVER") return "OVER";
  if (key === "UNDER") return "UNDER";
  return null;
}

function yesNo(raw) {
  const key = String(raw || "").toUpperCase();
  if (key === "YES") return "YES";
  if (key === "NO") return "NO";
  return null;
}

function oddEven(raw) {
  const key = String(raw || "").toUpperCase();
  if (key === "ODD") return "ODD";
  if (key === "EVEN") return "EVEN";
  return null;
}

function doubleChance(raw) {
  const key = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (key === "1X" || key === "X1") return "1X";
  if (key === "12" || key === "21") return "12";
  if (key === "X2" || key === "2X") return "X2";
  return null;
}

function numericLine(catalogue) {
  const n = Number(catalogue?.handicap);
  return Number.isFinite(n) ? n : null;
}

function parseScore(raw) {
  const m = /^\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\s*$/.exec(String(raw || ""));
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

function parseHtFt(raw) {
  const parts = String(raw || "").split("/");
  if (parts.length !== 2) return null;
  const ht = side1x2(parts[0]) || doubleChance(parts[0]);
  const ft = side1x2(parts[1]) || doubleChance(parts[1]);
  if (!ht || !ft) return null;
  if (!["HOME", "DRAW", "AWAY"].includes(ht)) return null;
  if (!["HOME", "DRAW", "AWAY"].includes(ft)) return null;
  return { ht, ft };
}

function formatHandicap(n) {
  if (!Number.isFinite(n)) return "";
  if (Object.is(n, -0) || n === 0) return "0";
  return n > 0 ? `+${n}` : String(n);
}

function ouLabel(side, line) {
  return `${side === "OVER" ? "Over" : "Under"} ${line}`;
}

/**
 * Each handler receives the outcome label and catalogue entry and returns
 * `{ market_code, selection, params }`, or `null` when the outcome is not one
 * we can map onto a V2 code.
 */
const FAMILIES = new Map([
  [
    "1x2|fulltime",
    (name) => {
      const side = side1x2(name);
      return side && { market_code: "MATCH_WINNER", selection: name, params: { side } };
    },
  ],
  [
    "1x2|p1",
    (name) => {
      const side = side1x2(name);
      return side && { market_code: "HALF_TIME_RESULT", selection: name, params: { side } };
    },
  ],
  [
    "1x2|p2",
    (name) => {
      const side = side1x2(name);
      return side && { market_code: "SECOND_HALF_RESULT", selection: name, params: { side } };
    },
  ],
  [
    "doublechance|fulltime",
    (name) => {
      const combination = doubleChance(name);
      return (
        combination && {
          market_code: "DOUBLE_CHANCE",
          selection: combination,
          params: { combination },
        }
      );
    },
  ],
  [
    "doublechance|p1",
    (name) => {
      const combination = doubleChance(name);
      return (
        combination && {
          market_code: "DOUBLE_CHANCE_HT",
          selection: combination,
          params: { combination },
        }
      );
    },
  ],
  [
    "doublechance|p2",
    (name) => {
      const combination = doubleChance(name);
      return (
        combination && {
          market_code: "DOUBLE_CHANCE_SH",
          selection: combination,
          params: { combination },
        }
      );
    },
  ],
  [
    "drawnobet|fulltime",
    (name) => {
      const side = side1x2(name);
      if (!side || side === "DRAW") return null;
      return { market_code: "DRAW_NO_BET", selection: name, params: { side } };
    },
  ],
  [
    "drawnobet|p1",
    (name) => {
      const side = side1x2(name);
      if (!side || side === "DRAW") return null;
      return { market_code: "DRAW_NO_BET_HT", selection: name, params: { side } };
    },
  ],
  [
    "drawnobet|p2",
    (name) => {
      const side = side1x2(name);
      if (!side || side === "DRAW") return null;
      return { market_code: "DRAW_NO_BET_SH", selection: name, params: { side } };
    },
  ],
  [
    "bothteamsscore|fulltime",
    (name) => {
      const pick = yesNo(name);
      return pick && { market_code: "BTTS", selection: pick, params: { pick } };
    },
  ],
  [
    "bothteamsscore|p1",
    (name) => {
      const pick = yesNo(name);
      return pick && { market_code: "BTTS_HT", selection: pick, params: { pick } };
    },
  ],
  [
    "bothteamsscore|p2",
    (name) => {
      const pick = yesNo(name);
      return pick && { market_code: "BTTS_SH", selection: pick, params: { pick } };
    },
  ],
  [
    "totals|fulltime",
    (name, catalogue) => {
      const side = overUnderSide(name);
      const line = numericLine(catalogue);
      if (!side || line === null) return null;
      return {
        market_code: "OVER_UNDER",
        selection: ouLabel(side, line),
        params: { side, line },
      };
    },
  ],
  [
    "totals|p1",
    (name, catalogue) => {
      const side = overUnderSide(name);
      const line = numericLine(catalogue);
      if (!side || line === null) return null;
      return {
        market_code: "HT_OVER_UNDER",
        selection: ouLabel(side, line),
        params: { side, line },
      };
    },
  ],
  [
    "totals|p2",
    (name, catalogue) => {
      const side = overUnderSide(name);
      const line = numericLine(catalogue);
      if (!side || line === null) return null;
      return {
        market_code: "SH_OVER_UNDER",
        selection: ouLabel(side, line),
        params: { side, line },
      };
    },
  ],
  [
    "oddeven|fulltime",
    (name) => {
      const pick = oddEven(name);
      return pick && { market_code: "ODD_EVEN", selection: pick, params: { pick } };
    },
  ],
  [
    "oddeven|p1",
    (name) => {
      const pick = oddEven(name);
      return pick && { market_code: "ODD_EVEN_HT", selection: pick, params: { pick } };
    },
  ],
  [
    "oddeven|p2",
    (name) => {
      const pick = oddEven(name);
      return pick && { market_code: "ODD_EVEN_SH", selection: pick, params: { pick } };
    },
  ],
  [
    "spreads|fulltime",
    (name, catalogue) => {
      const side = side1x2(name);
      const handicap = numericLine(catalogue);
      if (!side || side === "DRAW" || handicap === null) return null;
      return {
        market_code: "HANDICAP_ASIAN",
        selection: name,
        params: { side, handicap },
      };
    },
  ],
  [
    "spreads|p1",
    (name, catalogue) => {
      const side = side1x2(name);
      const handicap = numericLine(catalogue);
      if (!side || side === "DRAW" || handicap === null) return null;
      return {
        market_code: "HANDICAP_ASIAN_HT",
        selection: name,
        params: { side, handicap },
      };
    },
  ],
  [
    "spreads|p2",
    (name, catalogue) => {
      const side = side1x2(name);
      const handicap = numericLine(catalogue);
      if (!side || side === "DRAW" || handicap === null) return null;
      return {
        market_code: "HANDICAP_ASIAN_SH",
        selection: name,
        params: { side, handicap },
      };
    },
  ],
  [
    "correctscore|fulltime",
    (name) => {
      const score = parseScore(name);
      return (
        score && {
          market_code: "CORRECT_SCORE",
          selection: `${score.home}-${score.away}`,
          params: score,
        }
      );
    },
  ],
  [
    "correctscore|p1",
    (name) => {
      const score = parseScore(name);
      return (
        score && {
          market_code: "CORRECT_SCORE_HT",
          selection: `${score.home}-${score.away}`,
          params: score,
        }
      );
    },
  ],
  [
    "htft|fulltime",
    (name) => {
      const combo = parseHtFt(name);
      return combo && { market_code: "HT_FT", selection: name, params: combo };
    },
  ],
  [
    "halftime/fulltime|fulltime",
    (name) => {
      const combo = parseHtFt(name);
      return combo && { market_code: "HT_FT", selection: name, params: combo };
    },
  ],
]);

/** Market ids whose catalogue `marketType` is unreliable across API versions. */
const MARKET_ID_OVERRIDES = new Map([[104, "bothteamsscore|fulltime"]]);

export function familyKey(marketId, catalogue) {
  const override = MARKET_ID_OVERRIDES.get(Number(marketId));
  if (override) return override;
  return `${catalogue?.marketType ?? ""}|${catalogue?.period ?? ""}`;
}

export function isBridgeable(marketId, catalogue) {
  if (catalogue?.playerProp) return false;
  return FAMILIES.has(familyKey(marketId, catalogue));
}

/**
 * @returns {{ market_code: string, selection: string, params: object }|null}
 */
export function bridgeSelection(marketId, outcomeId, catalogue) {
  if (catalogue?.playerProp) return null;
  const handler = FAMILIES.get(familyKey(marketId, catalogue));
  if (!handler) return null;
  const name = label(catalogue, outcomeId);
  if (!name) return null;
  return handler(name, catalogue) || null;
}

/** Market families the bridge covers, for reporting and tests. */
export function bridgedFamilies() {
  return [...FAMILIES.keys()];
}

/**
 * The four codes the original cutover offered. Kept for tests / docs; ingest
 * no longer filters on this set.
 */
export const CUTOVER_CODES = Object.freeze([
  "MATCH_WINNER",
  "DOUBLE_CHANCE",
  "BTTS",
  "OVER_UNDER",
]);

/** Exact strings `fixturesListService` and `PROVIDER_NAME_TO_CODE` expect. */
export const LEGACY_MARKET_NAMES = Object.freeze({
  MATCH_WINNER: "Match Winner",
  DOUBLE_CHANCE: "Double Chance",
  BTTS: "Both Teams Score",
  OVER_UNDER: "Goals Over/Under",
  DRAW_NO_BET: "Draw No Bet",
  ODD_EVEN: "Odd/Even",
  HALF_TIME_RESULT: "First Half Winner",
  SECOND_HALF_RESULT: "Second Half Winner",
  HT_OVER_UNDER: "Goals Over/Under First Half",
  SH_OVER_UNDER: "Goals Over/Under - Second Half",
  HANDICAP_ASIAN: "Asian Handicap",
  HANDICAP_ASIAN_HT: "Asian Handicap First Half",
  HANDICAP_ASIAN_SH: "Asian Handicap (2nd Half)",
  CORRECT_SCORE: "Correct Score",
  CORRECT_SCORE_HT: "Correct Score - First Half",
  HT_FT: "HT/FT Double",
  DOUBLE_CHANCE_HT: "Double Chance - First Half",
  DOUBLE_CHANCE_SH: "Double Chance - Second Half",
  DRAW_NO_BET_HT: "Draw No Bet (1st Half)",
  DRAW_NO_BET_SH: "Draw No Bet (2nd Half)",
  BTTS_HT: "Both Teams Score - First Half",
  BTTS_SH: "Both Teams To Score - Second Half",
  ODD_EVEN_HT: "Odd/Even - First Half",
  ODD_EVEN_SH: "Odd/Even - Second Half",
  CORNERS_OVER_UNDER: "Corners Over Under",
  CORNERS_1X2_FT: "Corners 1x2",
  CORNERS_HANDICAP_ASIAN: "Corners Asian Handicap",
  CARDS_OVER_UNDER: "Cards Over/Under",
  CARDS_1X2_FT: "Cards 1x2",
  TEAM_TOTAL_HOME: "Total - Home",
  TEAM_TOTAL_AWAY: "Total - Away",
});

const ONE_X_TWO_VALUES = Object.freeze({ HOME: "Home", DRAW: "Draw", AWAY: "Away" });
const DC_VALUES = Object.freeze({
  "1X": "Home/Draw",
  "12": "Home/Away",
  X2: "Draw/Away",
});
const YES_NO_VALUES = Object.freeze({ YES: "Yes", NO: "No" });
const OE_VALUES = Object.freeze({ ODD: "Odd", EVEN: "Even" });

function statKind(marketName) {
  const n = String(marketName || "").toLowerCase();
  if (/corner/.test(n)) return "corners";
  if (/yellow/.test(n)) return "yellow";
  if (/card|booking|booked/.test(n)) return "cards";
  if (/offside/.test(n)) return "offsides";
  if (/foul/.test(n)) return "fouls";
  if (/\bshots?\b/.test(n)) return "shots";
  if (/save/.test(n)) return "saves";
  return "goals";
}

function homeOrAwayOnly(marketName) {
  const n = String(marketName || "").toLowerCase();
  const hasHome = /\bhome\b/.test(n);
  const hasAway = /\baway\b/.test(n);
  if (hasHome && !hasAway) return "HOME";
  if (hasAway && !hasHome) return "AWAY";
  return null;
}

function remapStatCode(bridged, kind) {
  if (!bridged || kind === "goals") return bridged;
  const code = bridged.market_code;
  if (kind === "corners") {
    if (code === "MATCH_WINNER") return { ...bridged, market_code: "CORNERS_1X2_FT" };
    if (code === "OVER_UNDER") return { ...bridged, market_code: "CORNERS_OVER_UNDER" };
    if (code === "HANDICAP_ASIAN") {
      return { ...bridged, market_code: "CORNERS_HANDICAP_ASIAN" };
    }
  }
  if (kind === "cards" || kind === "yellow") {
    if (code === "MATCH_WINNER") return { ...bridged, market_code: "CARDS_1X2_FT" };
    if (code === "OVER_UNDER") return { ...bridged, market_code: "CARDS_OVER_UNDER" };
  }
  return null;
}

function remapTeamTotal(bridged, marketName) {
  if (!bridged) return bridged;
  const team = homeOrAwayOnly(marketName);
  if (!team) return bridged;
  if (bridged.market_code !== "OVER_UNDER") return bridged;
  return {
    ...bridged,
    market_code: team === "HOME" ? "TEAM_TOTAL_HOME" : "TEAM_TOTAL_AWAY",
    params: { ...bridged.params, team },
  };
}

function scopedTeamName(catalogue, kind) {
  const team = homeOrAwayOnly(catalogue?.marketName);
  if (!team) return null;
  const period = catalogue?.period;
  const home = team === "HOME";
  if (kind === "goals") {
    if (period === "p1") {
      return home
        ? "Home Team Total Goals(1st Half)"
        : "Away Team Total Goals(1st Half)";
    }
    if (period === "p2") {
      return home
        ? "Home Team Total Goals(2nd Half)"
        : "Away Team Total Goals(2nd Half)";
    }
    return home ? "Total - Home" : "Total - Away";
  }
  if (kind === "corners") {
    if (period === "p1") {
      return home
        ? "Home Total Corners (1st Half)"
        : "Away Total Corners (1st Half)";
    }
    if (period === "p2") {
      return home
        ? "Home Total Corners (2nd Half)"
        : "Away Total Corners (2nd Half)";
    }
    return home ? "Home Corners Over/Under" : "Away Corners Over/Under";
  }
  if (kind === "cards") {
    return home ? "Home Team Total Cards" : "Away Team Total Cards";
  }
  if (kind === "yellow") {
    return home ? "Home Team Yellow Cards" : "Away Team Yellow Cards";
  }
  return null;
}

function periodSuffix(period) {
  if (!period || period === "fulltime") return "";
  if (period === "p1") return " - First Half";
  if (period === "p2") return " - Second Half";
  return ` (${period})`;
}

function fallbackName(catalogue, marketId) {
  const base = String(catalogue?.marketName || "").trim();
  if (!base) return `Market ${Number(marketId) || ""}`.trim();
  if (/first half|1st half|second half|2nd half/i.test(base)) return base;
  return `${base}${periodSuffix(catalogue?.period)}`;
}

function oneXTwoValue(side) {
  return ONE_X_TWO_VALUES[side] || null;
}

function spreadValue(side, handicap) {
  const line = side === "AWAY" ? -Number(handicap) : Number(handicap);
  const team = side === "HOME" ? "Home" : "Away";
  return `${team} ${formatHandicap(line)}`.trim();
}

function displayValue(bridged) {
  const code = bridged.market_code;
  const params = bridged.params || {};
  if (code === "MATCH_WINNER" || code === "HALF_TIME_RESULT" || code === "SECOND_HALF_RESULT"
      || code === "CORNERS_1X2_FT" || code === "CARDS_1X2_FT") {
    return oneXTwoValue(params.side);
  }
  if (code === "DOUBLE_CHANCE" || code === "DOUBLE_CHANCE_HT" || code === "DOUBLE_CHANCE_SH") {
    return DC_VALUES[params.combination] || null;
  }
  if (code === "BTTS" || code === "BTTS_HT" || code === "BTTS_SH") {
    return YES_NO_VALUES[params.pick] || null;
  }
  if (code === "ODD_EVEN" || code === "ODD_EVEN_HT" || code === "ODD_EVEN_SH") {
    return OE_VALUES[params.pick] || null;
  }
  if (code === "DRAW_NO_BET" || code === "DRAW_NO_BET_HT" || code === "DRAW_NO_BET_SH") {
    return oneXTwoValue(params.side);
  }
  if (
    code === "OVER_UNDER" ||
    code === "HT_OVER_UNDER" ||
    code === "SH_OVER_UNDER" ||
    code === "CORNERS_OVER_UNDER" ||
    code === "CARDS_OVER_UNDER" ||
    code === "TEAM_TOTAL_HOME" ||
    code === "TEAM_TOTAL_AWAY"
  ) {
    return bridged.selection;
  }
  if (
    code === "HANDICAP_ASIAN" ||
    code === "HANDICAP_ASIAN_HT" ||
    code === "HANDICAP_ASIAN_SH" ||
    code === "CORNERS_HANDICAP_ASIAN"
  ) {
    return spreadValue(params.side, params.handicap);
  }
  if (code === "CORRECT_SCORE" || code === "CORRECT_SCORE_HT") {
    return bridged.selection;
  }
  if (code === "HT_FT") return bridged.selection;
  return bridged.selection || null;
}

function outcomeFallback(catalogue, outcomeId, line) {
  const outcome = label(catalogue, outcomeId) || String(line?.value || outcomeId || "").trim();
  const lineNum = numericLine(catalogue);
  const side = overUnderSide(outcome);
  if (side && lineNum !== null) return ouLabel(side, lineNum);
  const ah = side1x2(outcome);
  if (ah && ah !== "DRAW" && lineNum !== null && lineNum !== 0) {
    return spreadValue(ah, lineNum);
  }
  return outcome || String(outcomeId);
}

function withPlayer(value, line) {
  const pid = Number(line?.playerId);
  const playerName = String(line?.playerName || "").trim();
  if (!Number.isFinite(pid) || pid === 0 || !playerName) return value;
  return `${playerName} - ${value}`;
}

/**
 * Map an OddsPapi (marketId, outcomeId) onto the public storage contract:
 * `FixtureMarket.name` + `FixtureOddLine.value`. Never returns null for a
 * priced outcome — unknown families fall back to the catalogue name.
 *
 * @returns {{
 *   market_code: string|null,
 *   selection: string,
 *   params: object,
 *   name: string,
 *   value: string,
 * }}
 */
export function publicMarket(marketId, outcomeId, catalogue, line = null) {
  const kind = statKind(catalogue?.marketName);
  let bridged = remapStatCode(bridgeSelection(marketId, outcomeId, catalogue), kind);
  if (kind === "goals") bridged = remapTeamTotal(bridged, catalogue?.marketName);
  const ouFamily = [
    "OVER_UNDER",
    "HT_OVER_UNDER",
    "SH_OVER_UNDER",
    "CORNERS_OVER_UNDER",
    "CARDS_OVER_UNDER",
    "TEAM_TOTAL_HOME",
    "TEAM_TOTAL_AWAY",
  ].includes(bridged?.market_code);
  let name = ouFamily ? scopedTeamName(catalogue, kind) : null;
  if (!name && bridged) name = LEGACY_MARKET_NAMES[bridged.market_code] || null;
  let value = bridged ? displayValue(bridged) : null;
  if (!name) name = fallbackName(catalogue, marketId);
  if (!value) value = outcomeFallback(catalogue, outcomeId, line);
  value = withPlayer(value, line);
  return {
    market_code: bridged?.market_code || null,
    selection: bridged?.selection || value,
    params: bridged?.params || {},
    name,
    value,
  };
}

/** @deprecated Use `publicMarket`. Same mapper; name kept for existing callers. */
export function legacyMarket(marketId, outcomeId, catalogue, line = null) {
  return publicMarket(marketId, outcomeId, catalogue, line);
}

function changedAtMs(ol) {
  const raw = ol?.changed_at ?? ol?.changedAt;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Keep one line per selection value. Newest `changed_at` wins; a missing
 * timestamp is treated as oldest so a stale-but-active leftover cannot beat
 * a fresher copy.
 */
export function collapseOddLinesByValue(oddLines) {
  const best = new Map();
  for (const ol of oddLines || []) {
    const key = String(ol?.value ?? "");
    const prev = best.get(key);
    if (!prev || changedAtMs(ol) >= changedAtMs(prev)) {
      best.set(key, ol);
    }
  }
  return [...best.values()];
}

/**
 * Group flattened OddsPapi lines into the public `{ name, odd_lines }` shape.
 */
export function legacyMarketsFromLines(lines, marketMap = {}, { bookSuspended = false } = {}) {
  const byName = new Map();
  for (const line of lines || []) {
    const mapped = publicMarket(
      line.marketId,
      line.outcomeId,
      marketMap[String(line.marketId)],
      line,
    );
    if (!mapped?.name || !mapped?.value) continue;
    const active = line.active !== false && !bookSuspended;
    if (!byName.has(mapped.name)) byName.set(mapped.name, []);
    byName.get(mapped.name).push({
      value: mapped.value,
      odd: line.price,
      active,
      changed_at: line.changedAt || null,
      suspended: !active,
    });
  }
  return [...byName.entries()].map(([name, odd_lines]) => ({
    name,
    odd_lines: collapseOddLinesByValue(odd_lines),
  }));
}
