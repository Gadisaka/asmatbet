import { getOddspapiConfig } from "../../services/providers/oddspapi/config.js";
import { getAccount, getMarkets, getTournaments } from "../../services/providers/oddspapi/endpoints.js";
import { quotaSnapshot } from "../../services/providers/oddspapi/quota.js";
import { cacheMarkets, cacheTournaments } from "./cache.js";

export async function runOddspapiCatalogue() {
  const cfg = getOddspapiConfig();
  const { sub } = await getAccount();
  const snap = await quotaSnapshot();
  console.log(
    `[oddspapi:catalogue] quota ${snap.count}/${snap.limit} mode=${snap.mode} burn=${snap.burnRatio.toFixed(2)}`,
  );

  const t = await getTournaments(cfg.sportId);
  const tournaments = t.list || [];
  await cacheTournaments(tournaments);
  const live = tournaments.filter((x) => x.liveFixtures > 0).length;
  const upcoming = tournaments.filter((x) => x.upcomingFixtures > 0).length;
  console.log(
    `[oddspapi:catalogue] tournaments=${tournaments.length} live=${live} upcoming=${upcoming} ${t.ms}ms`,
  );

  const m = await getMarkets();
  const soccer = (m.list || []).filter(
    (row) => row.sportId === cfg.sportId || row.sportId == null,
  );
  const map = {};
  for (const row of soccer) {
    const outcomes = {};
    for (const o of row.outcomes || []) {
      outcomes[String(o.outcomeId)] = o.outcomeName;
    }
    map[String(row.marketId)] = {
      marketName: row.marketName,
      marketType: row.marketType,
      period: row.period,
      handicap: row.handicap,
      playerProp: Boolean(row.playerProp),
      outcomes,
    };
  }
  await cacheMarkets(map);
  console.log(`[oddspapi:catalogue] soccer markets=${soccer.length} ${m.ms}ms`);

  return {
    tournaments: tournaments.length,
    live,
    upcoming,
    markets: soccer.length,
    quota: snap,
    bookmakers: sub?.bookmakers || null,
  };
}
