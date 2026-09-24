#!/usr/bin/env node
/**
 * One-off: move OddsPapi odd lines off leftover bookmaker rows (API-Football
 * 1xBet id 11, or any other match) onto the canonical namespaced row
 * (910000001). Colliding canonical lines are deleted first so the live copy
 * wins, then leftovers on other bookmakers are removed.
 *
 *   node scripts/dedupeOddspapiBookmakerLines.mjs
 *   node scripts/dedupeOddspapiBookmakerLines.mjs --live-only
 */
import "dotenv/config";
import prisma from "../Config/db.js";
import { PROVIDER } from "../services/providers/oddspapi/config.js";
import { resolveOddspapiBookmaker } from "../services/providers/oddspapi/bookmaker.js";

const PAGE = 80;
const FIXTURE_BATCH = 8;
const COLLISION_CHUNK = 20;
const liveOnly = process.argv.includes("--live-only");

function lineRecency(line) {
  const changed = Date.parse(line.changed_at);
  return Number.isFinite(changed) ? changed : 0;
}

function isUniqueClash(err) {
  return err?.code === "P2002";
}

function isRetryableWrite(err) {
  const code = err?.code;
  if (code === "P2034" || code === "P2028" || code === "P2010") return true;
  const msg = String(err?.message || "");
  return /write conflict|deadlock|TransactionExceeded/i.test(msg);
}

async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableWrite(err) || attempt === 8) throw err;
      const wait = Math.min(2000, 150 * 2 ** (attempt - 1));
      console.warn(`retry ${label} attempt=${attempt} wait=${wait}ms ${err.code || err.message}`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}

async function reassignLine(line, canonicalId) {
  await withRetry("delete-canonical", () =>
    prisma.fixtureOddLine.deleteMany({
      where: {
        market_id: line.market_id,
        bookmaker_id: canonicalId,
        value: line.value,
      },
    }),
  );
  try {
    await prisma.fixtureOddLine.update({
      where: { id: line.id },
      data: { bookmaker_id: canonicalId },
    });
    return true;
  } catch (err) {
    if (!isUniqueClash(err)) throw err;
    await withRetry("delete-canonical-retry", () =>
      prisma.fixtureOddLine.deleteMany({
        where: {
          market_id: line.market_id,
          bookmaker_id: canonicalId,
          value: line.value,
        },
      }),
    );
    try {
      await prisma.fixtureOddLine.update({
        where: { id: line.id },
        data: { bookmaker_id: canonicalId },
      });
      return true;
    } catch (retryErr) {
      if (!isUniqueClash(retryErr)) throw retryErr;
      console.warn(
        `skip unique clash market=${line.market_id} value=${line.value} id=${line.id}`,
      );
      return false;
    }
  }
}

function collapsePage(page) {
  const bestByKey = new Map();
  const dropIds = [];
  for (const line of page) {
    const key = `${line.market_id}\0${line.value}`;
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, line);
      continue;
    }
    if (lineRecency(line) > lineRecency(prev)) {
      dropIds.push(prev.id);
      bestByKey.set(key, line);
    } else {
      dropIds.push(line.id);
    }
  }
  return { keep: [...bestByKey.values()], dropIds };
}

async function migratePage(page, canonical) {
  const stats = {
    reassigned: 0,
    collisionsDeleted: 0,
    leftoversDeleted: 0,
    skipped: 0,
  };
  if (!page.length) return stats;

  const { keep, dropIds } = collapsePage(page);
  if (dropIds.length) {
    const dropped = await withRetry("delete-dup-foreign", () =>
      prisma.fixtureOddLine.deleteMany({
        where: { id: { in: dropIds } },
      }),
    );
    stats.leftoversDeleted += dropped.count;
  }
  if (!keep.length) return stats;

  for (let c = 0; c < keep.length; c += COLLISION_CHUNK) {
    const chunk = keep.slice(c, c + COLLISION_CHUNK);
    const colliding = await withRetry("delete-collision", () =>
      prisma.fixtureOddLine.deleteMany({
        where: {
          bookmaker_id: canonical.id,
          OR: chunk.map((line) => ({
            market_id: line.market_id,
            value: line.value,
          })),
        },
      }),
    );
    stats.collisionsDeleted += colliding.count;
  }

  try {
    const moved = await withRetry("update-canonical", () =>
      prisma.fixtureOddLine.updateMany({
        where: { id: { in: keep.map((line) => line.id) } },
        data: { bookmaker_id: canonical.id },
      }),
    );
    stats.reassigned += moved.count;
  } catch (err) {
    if (!isUniqueClash(err)) throw err;
    for (const line of keep) {
      const ok = await reassignLine(line, canonical.id);
      if (ok) stats.reassigned += 1;
      else stats.skipped += 1;
    }
  }

  const leftover = await prisma.fixtureOddLine.findMany({
    where: {
      id: { in: keep.map((line) => line.id) },
      bookmaker_id: { not: canonical.id },
    },
    select: { id: true },
  });
  if (leftover.length) {
    const dropped = await withRetry("delete-unmoved", () =>
      prisma.fixtureOddLine.deleteMany({
        where: { id: { in: leftover.map((line) => line.id) } },
      }),
    );
    stats.leftoversDeleted += dropped.count;
  }
  return stats;
}

function addStats(into, extra) {
  into.reassigned += extra.reassigned;
  into.collisionsDeleted += extra.collisionsDeleted;
  into.leftoversDeleted += extra.leftoversDeleted;
  into.skipped += extra.skipped;
}

async function main() {
  const canonical = await resolveOddspapiBookmaker();
  console.log(
    `canonical bookmaker id=${canonical.id} api_bookmaker_id=${canonical.api_bookmaker_id}`,
  );

  const fixtureWhere = liveOnly
    ? { provider: PROVIDER, status: { in: ["LIVE", "HT"] } }
    : { provider: PROVIDER };
  const fixtures = await prisma.fixture.findMany({
    where: fixtureWhere,
    select: { id: true },
  });
  console.log(`oddspapi fixtures=${fixtures.length}`);

  const stats = {
    reassigned: 0,
    collisionsDeleted: 0,
    leftoversDeleted: 0,
    skipped: 0,
  };

  for (let i = 0; i < fixtures.length; i += FIXTURE_BATCH) {
    const slice = fixtures.slice(i, i + FIXTURE_BATCH).map((f) => f.id);
    const markets = await prisma.fixtureMarket.findMany({
      where: { fixture_id: { in: slice } },
      select: { id: true },
    });
    const marketIds = markets.map((m) => m.id);
    if (marketIds.length) {
      let pages = 0;
      while (true) {
        const page = await prisma.fixtureOddLine.findMany({
          where: {
            market_id: { in: marketIds },
            bookmaker_id: { not: canonical.id },
          },
          select: { id: true, market_id: true, value: true, changed_at: true },
          take: PAGE,
        });
        if (!page.length) break;
        pages += 1;
        addStats(stats, await migratePage(page, canonical));
        if (pages === 1 || pages % 20 === 0) {
          console.log(
            `  batch ${i + 1}-${Math.min(i + FIXTURE_BATCH, fixtures.length)} page=${pages} ` +
              `reassigned=${stats.reassigned}`,
          );
        }
      }
    }

    const done = Math.min(i + FIXTURE_BATCH, fixtures.length);
    if (i === 0 || done === fixtures.length || done % 200 === 0) {
      console.log(
        `fixtures ${done}/${fixtures.length} reassigned=${stats.reassigned} ` +
          `collisionsDeleted=${stats.collisionsDeleted} leftoversDeleted=${stats.leftoversDeleted} skipped=${stats.skipped}`,
      );
    }
  }

  console.log(
    `reassigned=${stats.reassigned} collisionsDeleted=${stats.collisionsDeleted} ` +
      `leftoversDeleted=${stats.leftoversDeleted} skipped=${stats.skipped}`,
  );
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
