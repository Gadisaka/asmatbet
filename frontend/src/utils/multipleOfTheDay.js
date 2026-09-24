import { resolveCompactMarketToken } from "./compactMarketToken.js";
import { accumulatorPercentFromBonusesList } from "./accumulatorBonus.js";
import {
  getSportsbookDayOffset,
  SPORTSBOOK_TIMEZONE,
} from "./sportsbookDay.js";

export const MIN_MULTIPLE_LEGS = 3;
export const TARGET_MULTIPLE_LEGS = 5;
export const MIN_MULTIPLE_CARDS = 6;

const BLOCKED_STATUS =
  /^(LIVE|HT|1H|2H|FT|AET|PEN|FINISHED|CANC|PST|ABD|AWD|WO)/i;

export function marketMapOf(match) {
  return (match?.markets || []).reduce((acc, market) => {
    acc[String(market.id).toLowerCase()] = market.value;
    return acc;
  }, {});
}

function inRange(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max;
}

function isBlockedStatus(status) {
  return BLOCKED_STATUS.test(String(status || "").trim());
}

export function formatMultipleLegDate(kickoffAt) {
  if (!kickoffAt) return "";
  const date = new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString("en-GB", {
    timeZone: SPORTSBOOK_TIMEZONE,
    day: "2-digit",
    month: "short",
  });
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: SPORTSBOOK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${time}`;
}

function selectionName(match, token) {
  if (token === "1") return match.homeTeam || "Home";
  if (token === "2") return match.awayTeam || "Away";
  return "Draw";
}

function categoriesOf(match) {
  const detailed = match?.detailedOdds || {};
  return [...(detailed.main || []), ...(detailed.extra || [])];
}

function findCategoryOdd(match, categoryTest, idTest) {
  for (const cat of categoriesOf(match)) {
    if (!categoryTest(String(cat.category || "").toLowerCase())) continue;
    for (const odd of cat.odds || []) {
      if (idTest(String(odd.id || "").trim())) {
        return { category: cat.category, odd };
      }
    }
  }
  return null;
}

function isBttsCategory(name) {
  return name.includes("both teams");
}

function isGoalsOuCategory(name) {
  if (name.includes("half")) return false;
  return (
    name.includes("goals over") ||
    name === "over/under" ||
    name.includes("goals over/under")
  );
}

function pickFavorite(match, min = 1.3, max = 2.2) {
  const map = marketMapOf(match);
  const home = Number(map["1"]);
  const away = Number(map["2"]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const token = home <= away ? "1" : "2";
  if (!inRange(map[token], min, max)) return null;
  const meta = resolveCompactMarketToken(token);
  if (!meta) return null;
  return {
    ...meta,
    displayMarket: `Match Result — ${selectionName(match, token)}`,
    value: String(map[token]),
  };
}

function pickHomeWin(match) {
  const map = marketMapOf(match);
  if (!inRange(map["1"], 1.4, 2.2)) return null;
  const meta = resolveCompactMarketToken("1");
  if (!meta) return null;
  return {
    ...meta,
    displayMarket: `Match Result — ${selectionName(match, "1")}`,
    value: String(map["1"]),
  };
}

function pickAwayWin(match) {
  const map = marketMapOf(match);
  if (!inRange(map["2"], 1.65, 2.55)) return null;
  const meta = resolveCompactMarketToken("2");
  if (!meta) return null;
  return {
    ...meta,
    displayMarket: `Match Result — ${selectionName(match, "2")}`,
    value: String(map["2"]),
  };
}

function pickDoubleChance(match, token, min, max) {
  const map = marketMapOf(match);
  const key = String(token).toLowerCase();
  if (!inRange(map[key], min, max)) return null;
  const meta = resolveCompactMarketToken(key);
  if (!meta) return null;
  const labels = { "1x": "1X", 12: "12", x2: "X2" };
  return {
    ...meta,
    displayMarket: `Double Chance — ${labels[key] || meta.label}`,
    value: String(map[key]),
  };
}

function pickBttsYes(match) {
  const hit = findCategoryOdd(
    match,
    isBttsCategory,
    (id) => /^yes$/i.test(id),
  );
  if (!hit || !inRange(hit.odd.value, 1.4, 2.2)) return null;
  return {
    marketLabel: hit.category,
    marketCode: "BTTS",
    marketParams: { pick: "YES" },
    label: "YES",
    displayMarket: "Both Teams To Score — Yes",
    value: String(hit.odd.value),
  };
}

function pickGoalsLine(match, side, line, min, max) {
  const wanted = `${side} ${line}`;
  const hit = findCategoryOdd(match, isGoalsOuCategory, (id) => {
    const n = id.toLowerCase().replace(/\s+/g, " ");
    return n === wanted.toLowerCase();
  });
  if (!hit || !inRange(hit.odd.value, min, max)) return null;
  const sideCode = side.toUpperCase();
  return {
    marketLabel: hit.category,
    marketCode: "OVER_UNDER",
    marketParams: { side: sideCode, line },
    label: `${sideCode} ${line}`,
    displayMarket: `Goals ${side} ${line}`,
    value: String(hit.odd.value),
  };
}

const MIX_PICKS = [
  (match) => pickFavorite(match),
  (match) => pickBttsYes(match),
  (match) => pickGoalsLine(match, "Over", 2.5, 1.4, 2.2),
  (match) => pickDoubleChance(match, "1x", 1.18, 1.9),
  (match) => pickGoalsLine(match, "Under", 2.5, 1.4, 2.15),
];

function pickMixed(match, legIndex) {
  const start = Number(legIndex) % MIX_PICKS.length;
  for (let i = 0; i < MIX_PICKS.length; i += 1) {
    const hit = MIX_PICKS[(start + i) % MIX_PICKS.length](match);
    if (hit) return hit;
  }
  return null;
}

export function isMultipleCandidate(match, now = new Date()) {
  if (!match) return false;
  if (String(match.sportId || "").toLowerCase() !== "football") return false;
  if (isBlockedStatus(match.status)) return false;
  const kickoff = match.kickoffAt ? new Date(match.kickoffAt).getTime() : NaN;
  if (!Number.isFinite(kickoff) || kickoff <= now.getTime()) return false;
  return true;
}

function sortCandidates(matches, now) {
  return [...matches]
    .filter((match) => isMultipleCandidate(match, now))
    .sort((a, b) => {
      const ao = getSportsbookDayOffset(new Date(a.kickoffAt), now) ?? 99;
      const bo = getSportsbookDayOffset(new Date(b.kickoffAt), now) ?? 99;
      if (ao !== bo) return ao - bo;
      const ar = a.leagueRank ?? 9999;
      const br = b.leagueRank ?? 9999;
      if (ar !== br) return ar - br;
      const at = new Date(a.kickoffAt).getTime();
      const bt = new Date(b.kickoffAt).getTime();
      if (at !== bt) return at - bt;
      return Number(a.apiFixtureId || 0) - Number(b.apiFixtureId || 0);
    });
}

function toLeg(match, hit) {
  if (!hit?.value || !hit.marketCode) return null;
  return {
    id: `${match.apiFixtureId}-${hit.marketCode}-${hit.label}`,
    match: match.match,
    market: hit.displayMarket || hit.marketLabel,
    value: String(hit.value),
    date: formatMultipleLegDate(match.kickoffAt),
    apiFixtureId: match.apiFixtureId,
    matchName: match.match,
    league: match.league,
    kickoffAt: match.kickoffAt,
    matchStatus: match.status,
    fromLive: false,
    marketLabel: hit.marketLabel,
    marketCode: hit.marketCode,
    marketParams: hit.marketParams,
    label: hit.label,
  };
}

function collectLegs(candidates, pick, limit) {
  const used = new Set();
  const legs = [];
  for (const match of candidates) {
    if (legs.length >= limit) break;
    const fixtureId = match.apiFixtureId;
    if (fixtureId == null || used.has(fixtureId)) continue;
    const hit = pick(match, legs.length);
    if (!hit) continue;
    const leg = toLeg(match, hit);
    if (!leg) continue;
    used.add(fixtureId);
    legs.push(leg);
  }
  return legs;
}

const THEMES = Object.freeze([
  {
    id: "match-result",
    titleKey: "home.motdMatchResult",
    title: "Football. Matchday Match Result",
    pick: (match) => pickFavorite(match),
  },
  {
    id: "double-chance",
    titleKey: "home.motdDoubleChance",
    title: "Football. Matchday Double Chance",
    pick: (match) => pickDoubleChance(match, "1x", 1.18, 1.9),
  },
  {
    id: "btts",
    titleKey: "home.motdBtts",
    title: "Football. Matchday Both Teams To Score",
    pick: (match) => pickBttsYes(match),
  },
  {
    id: "over-25",
    titleKey: "home.motdOver25",
    title: "Football. Matchday Goals Over 2.5",
    pick: (match) => pickGoalsLine(match, "Over", 2.5, 1.4, 2.2),
  },
  {
    id: "mixed",
    titleKey: "home.motdMixed",
    title: "Football. Matchday Mixed Markets",
    pick: (match, index) => pickMixed(match, index),
  },
  {
    id: "under-25",
    titleKey: "home.motdUnder25",
    title: "Football. Matchday Goals Under 2.5",
    pick: (match) => pickGoalsLine(match, "Under", 2.5, 1.4, 2.15),
  },
  {
    id: "home-wins",
    titleKey: "home.motdHomeWins",
    title: "Football. Matchday Home Wins",
    pick: (match) => pickHomeWin(match),
  },
  {
    id: "dc-home-away",
    titleKey: "home.motdDcHomeAway",
    title: "Football. Matchday Double Chance 12",
    pick: (match) => pickDoubleChance(match, "12", 1.12, 1.7),
  },
]);

/**
 * Build accumulator tickets from upcoming football prices.
 * List rows now carry 1X2, Double Chance, BTTS, and totals, so cards mix those
 * markets instead of stacking Match Result only.
 */
export function buildMultipleOfTheDayTickets(
  matches = [],
  { bonuses = [], now = new Date() } = {},
) {
  const candidates = sortCandidates(matches, now);
  if (candidates.length < MIN_MULTIPLE_LEGS) return [];

  const tickets = [];
  for (const theme of THEMES) {
    const legs = collectLegs(candidates, theme.pick, TARGET_MULTIPLE_LEGS);
    if (legs.length < MIN_MULTIPLE_LEGS) continue;
    tickets.push({
      id: `mod-${theme.id}`,
      titleKey: theme.titleKey,
      title: theme.title,
      bonusPercent: accumulatorPercentFromBonusesList(bonuses, legs.length),
      legs,
    });
  }

  return tickets;
}

export function ticketToSlipSelections(ticket) {
  return (ticket?.legs || []).map((leg) => ({
    id: `${leg.matchName}-${leg.marketLabel}-${leg.label}`,
    apiFixtureId: leg.apiFixtureId,
    matchName: leg.matchName,
    league: leg.league,
    marketLabel: leg.marketLabel,
    marketCode: leg.marketCode,
    marketParams: leg.marketParams,
    label: leg.label,
    value: String(leg.value),
    kickoffAt: leg.kickoffAt,
    matchStatus: leg.matchStatus,
    fromLive: Boolean(leg.fromLive),
  }));
}
