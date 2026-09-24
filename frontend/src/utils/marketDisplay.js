import { normalizeMarketName } from "../data/footballMarketsByCategory.js";
import { resolveCompactMarketToken } from "./compactMarketToken.js";

/** Hero market order (API names → priority index). Lower = earlier. */
const MARKET_PRIORITY = [
  "match winner",
  "both teams score",
  "both teams to score",
  "double chance",
  "goals over/under",
  "ht/ft double",
  "odd/even",
];

/** Display headers keyed by normalized API name. */
const DISPLAY_NAMES = {
  "match winner": "1X2",
  "fulltime result": "1X2",
  "full time result": "1X2",
  "1x2": "1X2",
  "match result": "1X2",
  "both teams score": "BOTH TEAMS TO SCORE",
  "both teams to score": "BOTH TEAMS TO SCORE",
  "double chance": "DOUBLE CHANCE",
  "goals over/under": "TOTAL",
  "goals over/under first half": "TOTAL 1ST HALF",
  "goals over/under - second half": "TOTAL 2ND HALF",
  "ht/ft double": "HALFTIME/FULLTIME",
  "odd/even": "ODD/EVEN",
  "odd/even - first half": "ODD/EVEN 1ST HALF",
  "odd/even - second half": "ODD/EVEN 2ND HALF",
};

/**
 * @param {string} apiName
 * @returns {string}
 */
export function getMarketDisplayName(apiName) {
  const key = normalizeMarketName(apiName);
  if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];
  return String(apiName || "").trim() || "Market";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isMatchWinnerMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return (
    key === "match winner" ||
    key === "fulltime result" ||
    key === "full time result" ||
    key === "1x2" ||
    key === "match result"
  );
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isDoubleChanceMarket(marketName) {
  return normalizeMarketName(marketName) === "double chance";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isBttsMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return key === "both teams score" || key === "both teams to score";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isGoalsOverUnderMarket(marketName) {
  return normalizeMarketName(marketName) === "goals over/under";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isHtFtMarket(marketName) {
  return normalizeMarketName(marketName) === "ht/ft double";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isAsianHandicapMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return (
    key === "asian handicap" ||
    key === "asian handicap first half" ||
    key === "asian handicap (2nd half)"
  );
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isHandicapResultMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return (
    key === "handicap result" || key === "handicap result - first half"
  );
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isResultBttsMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return (
    key === "results/both teams score" || key === "result/both teams score"
  );
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isResultTotalMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return (
    key === "result/total goals" ||
    key === "result/total goals (2nd half)" ||
    key === "halftime result/total goals"
  );
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isTotalGoalsBttsMarket(marketName) {
  return normalizeMarketName(marketName) === "total goals/both teams to score";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isHomeAwayMarket(marketName) {
  return normalizeMarketName(marketName) === "home/away";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isHalfWinnerMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return key === "first half winner" || key === "second half winner";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isTeamToScoreMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return key === "team to score first" || key === "team to score last";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isWinBothHalvesMarket(marketName) {
  return normalizeMarketName(marketName) === "win both halves";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isWinToNilMarket(marketName) {
  return normalizeMarketName(marketName) === "win to nil";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isWinningMarginMarket(marketName) {
  return normalizeMarketName(marketName) === "winning margin";
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isExactGoalsMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return (
    key === "exact goals number" ||
    key === "exact goals number - first half" ||
    key === "home team exact goals number" ||
    key === "away team exact goals number" ||
    key === "home exact goals number (1st half)" ||
    key === "away exact goals number (1st half)"
  );
}

/**
 * Markets that show atomic 1/X/2 (or 1/2) as club names.
 * @param {string} marketName
 * @returns {boolean}
 */
function isAtomicTeamSideMarket(marketName) {
  return (
    isMatchWinnerMarket(marketName) ||
    isHomeAwayMarket(marketName) ||
    isHalfWinnerMarket(marketName) ||
    isTeamToScoreMarket(marketName) ||
    isWinBothHalvesMarket(marketName) ||
    isWinToNilMarket(marketName)
  );
}

/**
 * Normalize a single side token to HOME | DRAW | AWAY | null.
 * @param {string} raw
 * @returns {"HOME"|"DRAW"|"AWAY"|null}
 */
function normalizeHtFtSide(raw) {
  const key = String(raw || "")
    .trim()
    .toUpperCase();
  if (["1", "H", "HOME"].includes(key)) return "HOME";
  if (["X", "D", "DRAW"].includes(key)) return "DRAW";
  if (["2", "A", "AWAY"].includes(key)) return "AWAY";
  return null;
}

/**
 * @param {"HOME"|"DRAW"|"AWAY"|null} side
 * @returns {number}
 */
function htFtSideRank(side) {
  if (side === "HOME") return 0;
  if (side === "DRAW") return 1;
  if (side === "AWAY") return 2;
  return 99;
}

/**
 * @param {string} selectionId
 * @returns {{ ht: string, ft: string } | null}
 */
function parseHtFtParts(selectionId) {
  const parts = String(selectionId || "").split("/");
  if (parts.length !== 2) return null;
  return { ht: parts[0].trim(), ft: parts[1].trim() };
}

/**
 * @param {string} rawSide
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string}
 */
function formatSideLabel(rawSide, homeName, awayName) {
  const side = normalizeHtFtSide(rawSide);
  if (side === "HOME") return homeName;
  if (side === "DRAW") return "Draw";
  if (side === "AWAY") return awayName;
  return String(rawSide || "").trim();
}

/**
 * @param {string} selectionId
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string}
 */
function formatHtFtDisplayLabel(selectionId, homeName, awayName) {
  const parts = parseHtFtParts(selectionId);
  if (!parts) return String(selectionId || "").trim();
  return `${formatSideLabel(parts.ht, homeName, awayName)}/${formatSideLabel(parts.ft, homeName, awayName)}`;
}

/**
 * Atomic side / No for team-to-score and win-to-nil style picks.
 * @param {string} selectionId
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string|null}
 */
function formatAtomicTeamSideLabel(selectionId, homeName, awayName) {
  const raw = String(selectionId || "").trim();
  const lower = raw.toLowerCase();
  if (["no", "none", "neither", "no goal", "no score"].includes(lower)) {
    return "No";
  }
  const token = canonicalSelectionToken(raw);
  if (token === "1") return homeName;
  if (token === "x") return "Draw";
  if (token === "2") return awayName;
  return null;
}

/**
 * Handicap-style: "Home -0.5", "Away +1", "1 (-1)", "Draw 0".
 * @param {string} selectionId
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string}
 */
function formatHandicapDisplayLabel(selectionId, homeName, awayName) {
  const raw = String(selectionId || "").trim();
  const sideMatch = /\b(home|away|draw|h|a|d|1|2|x)\b/i.exec(raw);
  if (!sideMatch) return raw;
  const sideLabel = formatSideLabel(sideMatch[1], homeName, awayName);
  return raw.replace(sideMatch[0], sideLabel);
}

/**
 * Compound with a leading side token: "Home/Yes", "Home/Over 2.5".
 * @param {string} selectionId
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string}
 */
function formatSideCompoundDisplayLabel(selectionId, homeName, awayName) {
  const raw = String(selectionId || "").trim();
  const slash = raw.indexOf("/");
  if (slash <= 0) {
    const atomic = formatAtomicTeamSideLabel(raw, homeName, awayName);
    return atomic ?? raw;
  }
  const left = raw.slice(0, slash).trim();
  const right = raw.slice(slash + 1).trim();
  return `${formatSideLabel(left, homeName, awayName)}/${right}`;
}

/**
 * Winning Margin: "1 by 2", "Home by 2", "Draw".
 * @param {string} selectionId
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string}
 */
function formatWinningMarginDisplayLabel(selectionId, homeName, awayName) {
  const raw = String(selectionId || "").trim();
  const byMatch = raw.match(
    /^(.+?)\s+by\s+(\d+(?:\s*-\s*\d+)?|\d+\+)$/i,
  );
  if (byMatch) {
    const sideLabel = formatSideLabel(byMatch[1], homeName, awayName);
    return `${sideLabel} by ${byMatch[2].replace(/\s+/g, "")}`;
  }
  const atomic = formatAtomicTeamSideLabel(raw, homeName, awayName);
  return atomic ?? raw;
}

/**
 * Parse Total Goals/BTTS combo into ou + btts + line.
 * @param {string} selectionId
 * @returns {{ ou: "Over"|"Under"|null, btts: "Yes"|"No"|null, line: number|null }}
 */
function parseTotalGoalsBttsParts(selectionId) {
  const raw = String(selectionId || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  let ou = null;
  if (/\bover\b/.test(raw) || /^o\//.test(raw) || /(?:^|\/)o(?:\/|\s|$)/.test(raw)) {
    ou = "Over";
  }
  if (/\bunder\b/.test(raw) || /^u\//.test(raw) || /(?:^|\/)u(?:\/|\s|$)/.test(raw)) {
    ou = "Under";
  }

  let btts = null;
  if (/\byes\b/.test(raw)) btts = "Yes";
  else if (/\bno\b/.test(raw)) btts = "No";

  const line = parseOuThreshold(raw);

  return { ou, btts, line };
}

/**
 * Display as Yes/Under 2.5 (BTTS first, then OU + line).
 * @param {string} selectionId
 * @returns {string}
 */
function formatTotalGoalsBttsDisplayLabel(selectionId) {
  const { ou, btts, line } = parseTotalGoalsBttsParts(selectionId);
  if (!ou || !btts || line == null) {
    return String(selectionId || "").trim();
  }
  return `${btts}/${ou} ${line}`;
}

/**
 * Exact goals: "more 7" / "7+" → "more than 7".
 * @param {string} selectionId
 * @returns {string}
 */
function formatExactGoalsDisplayLabel(selectionId) {
  const raw = String(selectionId || "").trim();
  const plus = raw.match(/^(\d+)\+$/);
  if (plus) return `more than ${plus[1]}`;
  const moreN = raw.match(/^more(?:\s+than)?\s+(\d+)$/i);
  if (moreN) return `more than ${moreN[1]}`;
  const orMore = raw.match(/^(?:or\s+)?more\s+(\d+)$/i);
  if (orMore) return `more than ${orMore[1]}`;
  return raw;
}

/**
 * Normalize selection ids so Home/Draw-style API values map to compact tokens.
 * @param {string} selectionId
 * @returns {string}
 */
function canonicalSelectionToken(selectionId) {
  const id = String(selectionId || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (["home", "1"].includes(id)) return "1";
  if (["draw", "x"].includes(id)) return "x";
  if (["away", "2"].includes(id)) return "2";
  if (["1x", "home/draw", "home or draw", "x1"].includes(id)) return "1x";
  if (["12", "home/away", "home or away", "21"].includes(id)) return "12";
  if (["x2", "draw/away", "draw or away", "2x"].includes(id)) return "x2";
  return id;
}

/**
 * Team-aware display label for OddsCell / bet slip. Placement still uses the
 * canonical selection token via resolveExpansionSelectionMeta.
 *
 * @param {{
 *   marketName: string,
 *   selectionId: string,
 *   home?: string,
 *   away?: string,
 * }} args
 * @returns {string}
 */
export function formatSelectionDisplayLabel({
  marketName,
  selectionId,
  home = "Home",
  away = "Away",
}) {
  const id = canonicalSelectionToken(selectionId);
  const homeName = String(home || "Home").trim() || "Home";
  const awayName = String(away || "Away").trim() || "Away";
  const raw = String(selectionId || "").trim();

  if (isAtomicTeamSideMarket(marketName)) {
    const atomic = formatAtomicTeamSideLabel(raw, homeName, awayName);
    if (atomic) return atomic;
  }

  // HT/FT before DC: "Home/Draw" is a compound HT/FT outcome, not double chance.
  if (isHtFtMarket(marketName)) {
    return formatHtFtDisplayLabel(selectionId, homeName, awayName);
  }

  if (isAsianHandicapMarket(marketName) || isHandicapResultMarket(marketName)) {
    return formatHandicapDisplayLabel(raw, homeName, awayName);
  }

  if (isResultBttsMarket(marketName) || isResultTotalMarket(marketName)) {
    return formatSideCompoundDisplayLabel(raw, homeName, awayName);
  }

  if (isWinningMarginMarket(marketName)) {
    return formatWinningMarginDisplayLabel(raw, homeName, awayName);
  }

  if (isTotalGoalsBttsMarket(marketName)) {
    return formatTotalGoalsBttsDisplayLabel(raw);
  }

  if (isExactGoalsMarket(marketName)) {
    return formatExactGoalsDisplayLabel(raw);
  }

  // Double Chance (and DC compact tokens even if market name is missing)
  if (
    isDoubleChanceMarket(marketName) ||
    id === "1x" ||
    id === "12" ||
    id === "x2"
  ) {
    if (id === "1x") return `${homeName} or Draw`;
    if (id === "12") return `${homeName} or ${awayName}`;
    if (id === "x2") return `Draw or ${awayName}`;
  }

  return raw;
}

/**
 * Stable priority sort: hero markets first, then original relative order.
 *
 * @param {Array<{ category: string, odds?: unknown }>} categories
 * @returns {typeof categories}
 */
export function sortMarketsByPriority(categories) {
  if (!Array.isArray(categories) || categories.length < 2) {
    return Array.isArray(categories) ? [...categories] : [];
  }

  const priorityIndex = new Map(
    MARKET_PRIORITY.map((name, i) => [name, i]),
  );

  return categories
    .map((cat, index) => ({ cat, index }))
    .sort((a, b) => {
      const aKey = normalizeMarketName(a.cat.category);
      const bKey = normalizeMarketName(b.cat.category);
      const aPri = priorityIndex.has(aKey)
        ? priorityIndex.get(aKey)
        : Number.POSITIVE_INFINITY;
      const bPri = priorityIndex.has(bKey)
        ? priorityIndex.get(bKey)
        : Number.POSITIVE_INFINITY;
      if (aPri !== bPri) return aPri - bPri;
      return a.index - b.index;
    })
    .map(({ cat }) => cat);
}

/**
 * Extract Over/Under line threshold from a selection id like "Over 2.5".
 * @param {string} selectionId
 * @returns {number|null}
 */
function parseOuThreshold(selectionId) {
  const m = String(selectionId || "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} marketName
 * @returns {boolean}
 */
function isDrawNoBetMarket(marketName) {
  const key = normalizeMarketName(marketName);
  return key === "draw no bet" || key.startsWith("draw no bet (");
}

/**
 * Markets whose selections should render Home → Draw → Away.
 * @param {string} marketName
 * @returns {boolean}
 */
function needsTeamSideSort(marketName) {
  return (
    isAtomicTeamSideMarket(marketName) ||
    isDoubleChanceMarket(marketName) ||
    isDrawNoBetMarket(marketName) ||
    isAsianHandicapMarket(marketName) ||
    isHandicapResultMarket(marketName) ||
    isResultBttsMarket(marketName) ||
    isResultTotalMarket(marketName) ||
    isWinningMarginMarket(marketName)
  );
}

/**
 * Sort key: Home(0) → Draw(1) → Away(2) → No(3), plus a secondary tie-break.
 * @param {string} selectionId
 * @returns {[number, number]}
 */
function selectionSideSortKey(selectionId) {
  const raw = String(selectionId || "").trim();
  const token = canonicalSelectionToken(raw);

  if (token === "1x") return [0, 0];
  if (token === "12") return [1, 0];
  if (token === "x2") return [2, 0];
  if (token === "1") return [0, 0];
  if (token === "x") return [1, 0];
  if (token === "2") return [2, 0];

  const lower = raw.toLowerCase();
  if (["no", "none", "neither", "no goal", "no score"].includes(lower)) {
    return [3, 0];
  }

  const slash = raw.indexOf("/");
  if (slash > 0) {
    const left = normalizeHtFtSide(raw.slice(0, slash).trim());
    if (left) {
      const right = raw.slice(slash + 1).trim().toLowerCase();
      let secondary = 0;
      if (right.startsWith("under") || right.startsWith("no")) secondary = 1;
      return [htFtSideRank(left), secondary];
    }
  }

  const sideMatch = /\b(home|away|draw|h|a|d|1|2|x)\b/i.exec(raw);
  if (sideMatch) {
    const side = normalizeHtFtSide(sideMatch[1]);
    if (side) {
      const line = parseOuThreshold(raw);
      return [htFtSideRank(side), line ?? 0];
    }
  }

  return [99, 0];
}

/**
 * @param {string} marketName
 * @param {Array<{ id: string, value: string }>} odds
 * @returns {typeof odds}
 */
export function sortOddsWithinMarket(marketName, odds) {
  if (!Array.isArray(odds) || odds.length < 2) {
    return Array.isArray(odds) ? [...odds] : [];
  }

  if (isHtFtMarket(marketName)) {
    return [...odds].sort((a, b) => {
      const aParts = parseHtFtParts(a.id);
      const bParts = parseHtFtParts(b.id);
      if (!aParts && !bParts) return 0;
      if (!aParts) return 1;
      if (!bParts) return -1;
      const htDiff =
        htFtSideRank(normalizeHtFtSide(aParts.ht)) -
        htFtSideRank(normalizeHtFtSide(bParts.ht));
      if (htDiff !== 0) return htDiff;
      return (
        htFtSideRank(normalizeHtFtSide(aParts.ft)) -
        htFtSideRank(normalizeHtFtSide(bParts.ft))
      );
    });
  }

  if (isTotalGoalsBttsMarket(marketName)) {
    return [...odds].sort((a, b) => {
      const aParts = parseTotalGoalsBttsParts(a.id);
      const bParts = parseTotalGoalsBttsParts(b.id);
      const aLine = aParts.line;
      const bLine = bParts.line;
      if (aLine != null && bLine != null && aLine !== bLine) {
        return bLine - aLine;
      }
      if (aLine != null && bLine == null) return -1;
      if (aLine == null && bLine != null) return 1;
      // Over before Under
      const aOu = aParts.ou === "Over" ? 0 : aParts.ou === "Under" ? 1 : 2;
      const bOu = bParts.ou === "Over" ? 0 : bParts.ou === "Under" ? 1 : 2;
      if (aOu !== bOu) return aOu - bOu;
      // Yes before No
      const aBtts = aParts.btts === "Yes" ? 0 : aParts.btts === "No" ? 1 : 2;
      const bBtts = bParts.btts === "Yes" ? 0 : bParts.btts === "No" ? 1 : 2;
      return aBtts - bBtts;
    });
  }

  if (needsTeamSideSort(marketName)) {
    return [...odds].sort((a, b) => {
      const [aSide, aSecondary] = selectionSideSortKey(a.id);
      const [bSide, bSecondary] = selectionSideSortKey(b.id);
      if (aSide !== bSide) return aSide - bSide;
      return aSecondary - bSecondary;
    });
  }

  if (!isGoalsOverUnderMarket(marketName)) return [...odds];

  return [...odds].sort((a, b) => {
    const aLine = parseOuThreshold(a.id);
    const bLine = parseOuThreshold(b.id);
    if (aLine != null && bLine != null && aLine !== bLine) {
      return bLine - aLine; // higher threshold first (zoran-style)
    }
    if (aLine != null && bLine == null) return -1;
    if (aLine == null && bLine != null) return 1;
    // Same line: Over before Under
    const aOver = /^over/i.test(String(a.id));
    const bOver = /^over/i.test(String(b.id));
    if (aOver !== bOver) return aOver ? -1 : 1;
    return 0;
  });
}

/**
 * Tailwind grid column class for a market's odds grid.
 * @param {string} marketName
 * @returns {string}
 */
export function gridColsForMarket(marketName) {
  if (isHtFtMarket(marketName)) {
    return "grid-cols-2 md:grid-cols-4";
  }
  if (isMatchWinnerMarket(marketName) || isDoubleChanceMarket(marketName)) {
    return "grid-cols-3";
  }
  if (isBttsMarket(marketName) || isGoalsOverUnderMarket(marketName)) {
    return "grid-cols-2";
  }
  return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
}

/**
 * Placement metadata for an expansion pick. Prefer compact-token resolution for
 * Match Winner / Double Chance so labels stay canonical (1/X/2/1X/12/X2).
 *
 * @param {string} marketName API market.name
 * @param {string} selectionId normalized selection id (e.g. "1x", "over 2.5")
 * @returns {{
 *   marketLabel: string,
 *   label: string,
 *   displayLabel?: string,
 *   marketCode?: string,
 *   marketParams?: object,
 * }}
 */
export function resolveExpansionSelectionMeta(marketName, selectionId, teams = {}) {
  const home = teams.home || "Home";
  const away = teams.away || "Away";
  const tokenId = canonicalSelectionToken(selectionId);
  const displayLabel = formatSelectionDisplayLabel({
    marketName,
    selectionId,
    home,
    away,
  });

  const token = resolveCompactMarketToken(tokenId);
  if (
    token &&
    ((isMatchWinnerMarket(marketName) && token.marketCode === "MATCH_WINNER") ||
      (isDoubleChanceMarket(marketName) &&
        token.marketCode === "DOUBLE_CHANCE"))
  ) {
    return {
      marketLabel: marketName,
      label: token.label,
      displayLabel,
      marketCode: token.marketCode,
      marketParams: token.marketParams,
    };
  }

  return {
    marketLabel: marketName,
    label: String(selectionId || "").trim().toUpperCase(),
    displayLabel,
  };
}
