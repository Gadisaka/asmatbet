// Diagnose why a ticket's legs are stuck PENDING.
//   node scripts/diagStuckTicket.mjs                 # scan ALL pending legs
//   node scripts/diagStuckTicket.mjs kx092775        # one ticket by code
//
// For each PENDING leg it prints the fixture's DB state — the fields that decide
// whether settlement can run at all:
//   status              terminal? (FT/AET/... => settleable; NS/1H/... => never settled)
//   settled_at          has settlement been attempted?
//   grading_completed   all legs done?
//   home/away score     is the score on the row? (needed by score-only markets)
//   result_version      was it enriched? (events/stats fetched)
//   events_payload      present?
import { prisma } from "../Config/db.js";

const TERMINAL = ["FT", "AET", "PEN", "AWD", "WO", "CANC", "ABD", "PST"];
const arg = process.argv[2] || null;

function fmt(v) {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

try {
  // Resolve the leg set.
  let legs;
  if (arg) {
    const ticket = await prisma.ticket.findFirst({
      where: { OR: [{ coupon_number: arg }, { id: arg }] },
      select: { id: true, coupon_number: true, status: true },
    });
    if (!ticket) {
      console.log("No ticket found for", arg);
      process.exit(0);
    }
    console.log(`Ticket ${ticket.coupon_number || ticket.id} status=${ticket.status}`);
    legs = await prisma.ticketSelection.findMany({
      where: { ticket_id: ticket.id },
      select: { id: true, fixture_id: true, match_id: true, market_code: true, selection: true, result: true },
    });
  } else {
    legs = await prisma.ticketSelection.findMany({
      where: { result: "PENDING" },
      select: { id: true, fixture_id: true, match_id: true, market_code: true, selection: true, result: true },
    });
  }

  console.log(`\nLegs: ${legs.length}\n`);

  const fixtureIds = [...new Set(legs.map((l) => l.fixture_id).filter(Boolean))];
  const fixtures = await prisma.fixture.findMany({
    where: { id: { in: fixtureIds } },
    select: {
      id: true, api_fixture_id: true, status: true, start_time: true,
      home_score: true, away_score: true, settled_at: true,
      grading_completed_at: true, result_version: true, events_payload: true,
    },
  });
  const fx = new Map(fixtures.map((f) => [f.id, f]));

  let notTerminal = 0, terminalPending = 0, noScore = 0, noFixtureRow = 0, viaMatch = 0;
  for (const l of legs) {
    if (l.match_id && !l.fixture_id) { viaMatch++; continue; }
    const f = fx.get(l.fixture_id);
    if (!f) { noFixtureRow++; continue; }
    const term = TERMINAL.includes(String(f.status).toUpperCase());
    if (!term) notTerminal++;
    else terminalPending++;
    if (f.home_score == null || f.away_score == null) noScore++;
    console.log(
      `leg=${l.result} mkt=${l.market_code} sel="${l.selection}" | ` +
      `apiFx=${fmt(f.api_fixture_id)} status=${fmt(f.status)} term=${term} ` +
      `score=${fmt(f.home_score)}-${fmt(f.away_score)} ` +
      `settled_at=${fmt(f.settled_at)} graded=${fmt(f.grading_completed_at)} ` +
      `resultVer=${fmt(f.result_version)} events=${f.events_payload ? "yes" : "no"} ` +
      `start=${fmt(f.start_time)}`,
    );
  }

  console.log("\n=== SUMMARY ===");
  console.log("legs via match_id (not fixture):", viaMatch);
  console.log("legs whose fixture row missing  :", noFixtureRow);
  console.log("fixtures NOT terminal (no FT)   :", notTerminal, "  <-- settlement never runs on these");
  console.log("fixtures terminal & still pending:", terminalPending, "  <-- retry job should grade these");
  console.log("fixtures terminal but NO score   :", noScore);
} catch (err) {
  console.error("FAILED:", err?.message || err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
