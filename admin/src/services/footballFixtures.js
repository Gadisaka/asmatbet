import { API_URL } from "../../constants.js";

import { resolveCompactMarketToken } from "../utils/compactMarketToken.js";

function formatDateParam(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toUiOdd(value) {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return null;
  return n.toFixed(2);
}

function normalizeSelectionLabel(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (["home", "1"].includes(raw)) return "1";
  if (["draw", "x"].includes(raw)) return "x";
  if (["away", "2"].includes(raw)) return "2";
  if (["1x", "home/draw", "home or draw"].includes(raw)) return "1x";
  if (["12", "home/away", "home or away"].includes(raw)) return "12";
  if (["x2", "draw/away", "draw or away"].includes(raw)) return "x2";
  return String(value || "").trim();
}

function toCategoryOdds(lines = []) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const id = normalizeSelectionLabel(line.value);
    const value = toUiOdd(line.odd);
    if (!value || !id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, value });
  }
  return out;
}

function toSummaryMarkets(markets = []) {
  const map = {};
  for (const market of markets) {
    const name = String(market.name || "").toLowerCase();
    if (!name.includes("match winner") && !name.includes("double chance")) {
      continue;
    }
    const lines = toCategoryOdds(market.odd_lines || []);
    for (const { id, value } of lines) {
      const key = String(id).toLowerCase();
      if (name.includes("match winner") && ["1", "x", "2"].includes(key)) {
        map[key] = value;
      }
      if (name.includes("double chance") && ["1x", "12", "x2"].includes(key)) {
        map[key] = value;
      }
    }
  }
  return ["1", "x", "2", "1x", "x2", "12"].map((id) => ({
    id,
    value: map[id] || null,
  }));
}

export function mapFixtureToCashierMatch(fixture) {
  const home = fixture?.home_team?.name || "Home";
  const away = fixture?.away_team?.name || "Away";
  const leagueName = fixture?.league?.name || "Unknown League";
  const country = fixture?.league?.country || "Unknown";
  const markets = toSummaryMarkets(fixture?.markets || []);
  const kickoffAt = fixture?.start_time
    ? new Date(fixture.start_time).toISOString()
    : null;

  return {
    id: `fx-${fixture.api_fixture_id}`,
    apiFixtureId: fixture.api_fixture_id,
    league: `${country} - ${leagueName}`,
    match: `${home} V ${away}`,
    kickoffAt,
    status: fixture.status,
    markets,
  };
}

export async function fetchFixturesByDate(dateYmd = formatDateParam()) {
  const safe = encodeURIComponent(String(dateYmd || "").trim());
  const response = await fetch(`${API_URL}/football/fixtures?date=${safe}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || "Failed to load fixtures");
  }
  return Array.isArray(body) ? body : [];
}

export function buildSelectionPayloadFromOddClick(match, marketId) {
  const market = match.markets.find((item) => item.id === marketId);
  if (!market?.value) return null;

  const resolved = resolveCompactMarketToken(marketId);
  if (!resolved) return null;

  return {
    apiFixtureId: match.apiFixtureId,
    matchName: match.match,
    league: match.league,
    marketLabel: resolved.marketLabel,
    marketCode: resolved.marketCode,
    marketParams: resolved.marketParams,
    label: resolved.label,
    odds: Number(market.value),
    fromLive: false,
  };
}
