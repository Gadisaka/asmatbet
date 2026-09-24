/**
 * One-shot API-Football logo catalogue.
 *
 *   API_FOOTBALL_KEY=… node scripts/ingestApiFootballLogos.mjs
 *   API_FOOTBALL_KEY=… node scripts/ingestApiFootballLogos.mjs --upcoming-only
 *   node scripts/ingestApiFootballLogos.mjs --apply-only
 *
 * Pass the key on this process only. Do not add it to the running API/worker
 * env or the old API-Sports cron will start consuming quota.
 */
import prisma from "../Config/db.js";
import { deleteByPattern } from "../services/cacheService.js";
import {
  createLogoClient,
  runApiFootballLogoIngest,
} from "../services/providers/apifootball/logoIngest.js";

const args = new Set(process.argv.slice(2));

try {
  const client = args.has("--apply-only")
    ? null
    : createLogoClient({ apiKey: process.env.API_FOOTBALL_KEY });
  const result = await runApiFootballLogoIngest({
    prisma,
    client,
    deleteByPattern,
    applyOnly: args.has("--apply-only"),
    leaguesOnly: args.has("--leagues-only"),
    upcomingOnly: args.has("--upcoming-only"),
    force: args.has("--force"),
  });
  console.log("[logo-ingest] result", {
    storedLeagues: result.storedLeagues,
    storedTeams: result.storedTeams,
    fetchedLeagues: result.fetchedLeagues,
    applied: result.applied,
    remaining: result.remaining,
    stopped: result.stopped,
  });
} finally {
  await prisma.$disconnect().catch(() => {});
}
