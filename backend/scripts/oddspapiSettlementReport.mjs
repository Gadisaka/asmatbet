#!/usr/bin/env node
/**
 * Phase 3 gate report — is `/v4/settlements` trustworthy enough to pay on?
 *
 * Aggregates `ODDSPAPI_SETTLEMENT_SHADOW_MISMATCH` audit rows written by
 * `jobs/oddspapi/settlementShadow.js`, alongside the running agree/disagree
 * counters kept in Redis.
 *
 * The migration plan's exit criterion is: zero disagreements over 1,000+ legs,
 * or every disagreement explained.
 *
 * Usage:
 *   node backend/scripts/oddspapiSettlementReport.mjs
 *   node backend/scripts/oddspapiSettlementReport.mjs --hours 168
 *   node backend/scripts/oddspapiSettlementReport.mjs --json
 */
import prisma from "../Config/db.js";
import { getRedisClient } from "../services/cacheService.js";

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

const asJson = process.argv.includes("--json");
const hours = Number(argValue("--hours") || 24);

function tally(rows, pick) {
  const map = new Map();
  for (const row of rows) {
    const key = pick(row) ?? "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

async function run() {
  const since = new Date(Date.now() - hours * 3600_000);

  const rows = await prisma.auditLog.findMany({
    where: {
      action: "ODDSPAPI_SETTLEMENT_SHADOW_MISMATCH",
      created_at: { gte: since },
    },
    orderBy: { created_at: "asc" },
  });

  const stats = await getRedisClient()
    .hgetall("oddspapi:shadow:stats")
    .catch(() => ({}));
  const agree = Number(stats.settlement_agree || 0);
  const disagree = Number(stats.settlement_disagree || 0);
  const graded = agree + disagree;

  const summary = {
    since: since.toISOString(),
    windowHours: hours,
    fixturesChecked: Number(stats.settlement_fixtures || 0),
    legsGraded: graded,
    agree,
    disagree,
    agreementRate: graded ? Number(((agree / graded) * 100).toFixed(3)) : null,
    mismatchesInWindow: rows.length,
    byMarket: tally(rows, (r) => r.meta?.marketCode),
    byTransition: tally(
      rows,
      (r) => `${r.before?.provider?.raw || "?"} -> ours:${r.after?.ours?.result || "?"}`,
    ),
    byReason: tally(rows, (r) => r.after?.ours?.reason),
    gatePassed: graded >= 1000 && disagree === 0,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\nOddsPapi settlement shadow — last ${hours}h\n`);
    console.log(`  fixtures checked : ${summary.fixturesChecked}`);
    console.log(`  legs graded      : ${summary.legsGraded}`);
    console.log(`  agree            : ${summary.agree}`);
    console.log(`  disagree         : ${summary.disagree}`);
    console.log(
      `  agreement        : ${summary.agreementRate === null ? "n/a" : `${summary.agreementRate}%`}`,
    );
    console.log(
      `  phase-3 gate     : ${summary.gatePassed ? "PASSED" : "not yet (needs 1,000+ legs, 0 disagreements)"}\n`,
    );

    if (rows.length) {
      console.log(`  Mismatches by market code:`);
      for (const [k, v] of summary.byMarket) console.log(`    ${String(v).padStart(5)}  ${k}`);
      console.log(`\n  Mismatches by transition:`);
      for (const [k, v] of summary.byTransition) console.log(`    ${String(v).padStart(5)}  ${k}`);
      console.log(`\n  Our grader's reason:`);
      for (const [k, v] of summary.byReason) console.log(`    ${String(v).padStart(5)}  ${k}`);
      console.log("");
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
