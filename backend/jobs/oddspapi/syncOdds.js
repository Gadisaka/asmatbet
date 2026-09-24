import prisma from "../../Config/db.js";
import { upsertNoTx } from "../../utils/upsertNoTx.js";
import { getOddspapiConfig, PROVIDER } from "../../services/providers/oddspapi/config.js";
import { resolveOddspapiBookmaker } from "../../services/providers/oddspapi/bookmaker.js";
import { getOddsByTournaments } from "../../services/providers/oddspapi/endpoints.js";
import { flattenOdds, normalizeFixture } from "../../services/providers/oddspapi/normalize.js";
import { quotaSnapshot, allowOddsTier } from "../../services/providers/oddspapi/quota.js";
import { publicMarket } from "../../services/providers/oddspapi/marketBridge.js";
import { recomputeExtraMarketsCountForFixture } from "../../services/extraMarketsCount.js";
import { ingestFixtureList } from "./syncFixtures.js";
import { chunkIds, loadMarketMap, shadowStatsIncr } from "./cache.js";

async function dropProviderShapedMarkets(fixtureId) {
  const markets = await prisma.fixtureMarket.findMany({
    where: { fixture_id: fixtureId },
    select: { id: true, name: true },
  });
  const staleIds = markets.filter((m) => /^\d+:/.test(m.name)).map((m) => m.id);
  if (!staleIds.length) return 0;
  await prisma.fixtureMarket.deleteMany({ where: { id: { in: staleIds } } });
  return staleIds.length;
}

function parseChangedAt(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function persistLines(
  fixtureRow,
  lines,
  bookmaker,
  marketMap,
  { pruneMissing = true } = {},
) {
  if (pruneMissing) await dropProviderShapedMarkets(fixtureRow.id);

  const byName = new Map();
  for (const line of lines) {
    const cat = marketMap[String(line.marketId)];
    const mapped = publicMarket(line.marketId, line.outcomeId, cat, line);
    if (!mapped?.name || !mapped?.value) continue;
    if (!byName.has(mapped.name)) byName.set(mapped.name, []);
    byName.get(mapped.name).push({ line, mapped });
  }

  for (const [name, group] of byName) {
    const market = await upsertNoTx(prisma.fixtureMarket, {
      where: { fixture_id_name: { fixture_id: fixtureRow.id, name } },
      update: {},
      create: {
        fixture_id: fixtureRow.id,
        name,
      },
    });
    for (const { line, mapped } of group) {
      await upsertNoTx(prisma.fixtureOddLine, {
        where: {
          market_id_bookmaker_id_value: {
            market_id: market.id,
            bookmaker_id: bookmaker.id,
            value: mapped.value,
          },
        },
        update: {
          odd: line.price,
          provider_market_id: line.marketId,
          provider_outcome_id: line.outcomeId,
          provider_player_id: line.playerId,
          active: line.active,
          main_line: line.mainLine,
          max_limit: line.maxLimit,
          changed_at: parseChangedAt(line.changedAt),
        },
        create: {
          market_id: market.id,
          bookmaker_id: bookmaker.id,
          value: mapped.value,
          odd: line.price,
          provider_market_id: line.marketId,
          provider_outcome_id: line.outcomeId,
          provider_player_id: line.playerId,
          active: line.active,
          main_line: line.mainLine,
          max_limit: line.maxLimit,
          changed_at: parseChangedAt(line.changedAt),
        },
      });
    }
    if (pruneMissing) {
      const values = [...new Set(group.map(({ mapped }) => mapped.value))];
      await prisma.fixtureOddLine.deleteMany({
        where: {
          market_id: market.id,
          bookmaker_id: bookmaker.id,
          value: { notIn: values },
        },
      });
    }
  }
  await recomputeExtraMarketsCountForFixture(fixtureRow.id).catch(() => {});
}

/** Upsert a (possibly partial) OddsPapi odds blob onto an existing fixture. */
export async function persistOddspapiRawOdds(fixtureRow, raw, { pruneMissing = true } = {}) {
  const cfg = getOddspapiConfig();
  const bookmaker = await resolveOddspapiBookmaker(cfg.bookmaker);
  const marketMap = await loadMarketMap();
  const flat = flattenOdds(raw, cfg.bookmaker);
  if (!flat.lines.length) return { lines: 0 };
  await persistLines(fixtureRow, flat.lines, bookmaker, marketMap, { pruneMissing });
  return { lines: flat.lines.length };
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600_000);
}

async function tournamentIdsForTier(tier) {
  const now = new Date();
  let end;
  let start = now;
  if (tier === "hot") end = hoursFromNow(3);
  else if (tier === "warm") {
    start = now;
    end = hoursFromNow(24);
  } else {
    start = hoursFromNow(24);
    end = hoursFromNow(14 * 24);
  }

  const rows = await prisma.fixture.findMany({
    where: {
      provider: PROVIDER,
      start_time: { gte: start, lte: end },
      status: { in: ["NS", "LIVE", "HT"] },
      provider_tournament_id: { not: null },
    },
    select: { provider_tournament_id: true },
  });
  const ids = new Set(rows.map((r) => r.provider_tournament_id).filter(Boolean));

  // Kickoff is already in the past for in-play games, so the window above
  // never sees them. Hot ingest must still reseed their prices — the
  // WebSocket is deltas-only and cannot rebuild a book after reconnect.
  if (tier === "hot") {
    const liveRows = await prisma.fixture.findMany({
      where: {
        provider: PROVIDER,
        status: { in: ["LIVE", "HT"] },
        provider_tournament_id: { not: null },
      },
      select: { provider_tournament_id: true },
    });
    for (const r of liveRows) {
      if (r.provider_tournament_id) ids.add(r.provider_tournament_id);
    }
  }
  return [...ids];
}

export async function runOddspapiOdds({ tier = "hot" } = {}) {
  const snap = await quotaSnapshot();
  if (!allowOddsTier(snap.mode, tier)) {
    console.warn(`[oddspapi:odds] skip tier=${tier} quota mode=${snap.mode}`);
    return { tier, skipped: true, reason: snap.mode, batches: 0, fixtures: 0 };
  }

  const cfg = getOddspapiConfig();
  const ids = await tournamentIdsForTier(tier);
  if (!ids.length) {
    console.log(`[oddspapi:odds] tier=${tier} no local tournaments yet`);
    return { tier, batches: 0, fixtures: 0 };
  }

  const bookmaker = await resolveOddspapiBookmaker(cfg.bookmaker);
  const marketMap = await loadMarketMap();
  const batches = chunkIds(ids, cfg.batchSize);
  let fixtures = 0;
  let lines = 0;

  for (const batch of batches) {
    const res = await getOddsByTournaments(batch, { bucket: `odds_${tier}` });
    if (res.empty) continue;
    await ingestFixtureList(res.list);
    for (const raw of res.list) {
      let fx;
      try {
        fx = normalizeFixture(raw);
      } catch {
        continue;
      }
      const row = await prisma.fixture.findUnique({
        where: { api_fixture_id: fx.api_fixture_id },
      });
      if (!row) continue;
      const flat = flattenOdds(raw, cfg.bookmaker);
      if (!flat.lines.length) continue;
      await persistLines(row, flat.lines, bookmaker, marketMap);
      fixtures += 1;
      lines += flat.lines.length;
    }
    console.log(
      `[oddspapi:odds] tier=${tier} batch=${batch.join(",")} n=${res.list.length} ${res.ms}ms`,
    );
  }

  await shadowStatsIncr("odds_fixtures", fixtures);
  return { tier, batches: batches.length, fixtures, lines, tournaments: ids.length };
}
