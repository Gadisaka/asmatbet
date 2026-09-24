import prisma from "../../../Config/db.js";
import { upsertNoTx } from "../../../utils/upsertNoTx.js";
import { getOddspapiConfig, ODDSPAPI_BOOKMAKER_API_ID } from "./config.js";

const CACHE_MS = 60_000;
const persistBookmakerCache = { at: 0, row: null };

/**
 * Resolve the single OddsPapi bookmaker row by namespaced id.
 * Never matches on name or API-Football id 11 — those paths used to flip
 * writes onto a second row and leave stranded active prices.
 */
export async function resolveOddspapiBookmaker(name) {
  if (persistBookmakerCache.row && Date.now() - persistBookmakerCache.at < CACHE_MS) {
    return persistBookmakerCache.row;
  }
  const slug = String(name || getOddspapiConfig().bookmaker || "pinnacle+30").trim() || "pinnacle+30";
  const row = await upsertNoTx(prisma.bookmaker, {
    where: { api_bookmaker_id: ODDSPAPI_BOOKMAKER_API_ID },
    update: { name: slug },
    create: { api_bookmaker_id: ODDSPAPI_BOOKMAKER_API_ID, name: slug },
  });
  persistBookmakerCache.at = Date.now();
  persistBookmakerCache.row = row;
  return row;
}

export function clearOddspapiBookmakerCache() {
  persistBookmakerCache.at = 0;
  persistBookmakerCache.row = null;
}
