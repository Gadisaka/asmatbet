import { getCache, getRedisClient, setCache } from "../../services/cacheService.js";
import { getOddspapiConfig } from "../../services/providers/oddspapi/config.js";

const TOURNAMENTS_KEY = "oddspapi:tournaments";
const MARKETS_KEY = "oddspapi:markets";
const TOURNAMENTS_TTL = 2 * 3600;
const MARKETS_TTL = 7 * 24 * 3600;

export async function cacheTournaments(list) {
  await setCache(TOURNAMENTS_KEY, list, TOURNAMENTS_TTL);
}

export async function loadTournaments() {
  return (await getCache(TOURNAMENTS_KEY)) || [];
}

export async function cacheMarkets(map) {
  await setCache(MARKETS_KEY, map, MARKETS_TTL);
}

export async function loadMarketMap() {
  return (await getCache(MARKETS_KEY)) || {};
}

export async function marketName(marketId) {
  const map = await loadMarketMap();
  return map[String(marketId)]?.marketName || null;
}

export function chunkIds(ids, size) {
  const n = Math.max(1, size || getOddspapiConfig().batchSize);
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

export async function shadowStatsIncr(field, by = 1) {
  try {
    const key = "oddspapi:shadow:stats";
    await getRedisClient().hincrby(key, field, by);
    await getRedisClient().expire(key, 40 * 24 * 3600);
  } catch {
    /* non-fatal */
  }
}
