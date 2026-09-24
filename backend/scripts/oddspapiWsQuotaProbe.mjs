/**
 * Does the OddsPapi WebSocket consume our monthly request quota?
 *
 * `/v4/account` is documented as unmetered, so polling it is a free instrument
 * for observing `request_count` while the socket streams.
 *
 * A flat counter on its own proves nothing — it is equally consistent with "the
 * socket is free", "the counter lags", and "no messages arrived". So the probe
 * runs three phases:
 *
 *   A  idle      poll only; establishes that the counter is stable at rest
 *   B  control   N known-billable calls; proves the counter moves, and reveals
 *                its update lag. Without this the result is uninterpretable.
 *   C  socket    stream messages while polling; the actual measurement
 *
 * Verdict logic requires BOTH that the control moved the counter AND that the
 * socket delivered messages. Anything else reports INCONCLUSIVE rather than
 * guessing.
 *
 * Usage:
 *   ODDSPAPI_API_KEY=... node backend/scripts/oddspapiWsQuotaProbe.mjs [--socket-minutes=10]
 */

const BASE = process.env.ODDSPAPI_BASE_URL || "https://api.oddspapi.io";
const WS_BASE = process.env.ODDSPAPI_WS_URL || "wss://api.oddspapi.io/v4/ws";
const API_KEY = process.env.ODDSPAPI_API_KEY;

if (!API_KEY) {
  console.error(
    "Missing ODDSPAPI_API_KEY.\n" +
      "Pass it inline so it never lands in a file or shell history:\n" +
      "  ODDSPAPI_API_KEY=... node backend/scripts/oddspapiWsQuotaProbe.mjs",
  );
  process.exit(1);
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

const IDLE_MINUTES = Number(arg("idle-minutes", 2));
const SOCKET_MINUTES = Number(arg("socket-minutes", 10));
const CONTROL_CALLS = Number(arg("control-calls", 3));
const POLL_SECONDS = Number(arg("poll-seconds", 20));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).replaceAll(API_KEY, "***");
const stamp = () => new Date().toISOString().slice(11, 19);

// --- per-endpoint cooldown gate -------------------------------------------
// Every endpoint documents its own cooldown (500ms–5000ms) and enforces it with
// a 429 carrying `retryMs`. A single shared interval is not enough, so gate per
// path — the same shape the real client will need.

const COOLDOWN_MS = {
  "/v4/account": 1000,
  "/v4/sports": 1000,
  "/v4/tournaments": 1000,
};
const nextSlot = new Map();

async function paced(path, init) {
  const url = `${BASE}${path}?apiKey=${API_KEY}`;
  const cooldown = COOLDOWN_MS[path] ?? 1000;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wait = (nextSlot.get(path) ?? 0) - Date.now();
    if (wait > 0) await sleep(wait);
    nextSlot.set(path, Date.now() + cooldown);

    const res = await fetch(url, init);
    if (res.status !== 429) return res;

    // Honour the server's own backoff hint rather than guessing.
    let retryMs = cooldown;
    try {
      const body = await res.clone().json();
      retryMs = Number(body?.error?.retryMs) || cooldown;
    } catch {
      /* fall back to the documented cooldown */
    }
    if (body429IsQuota(await res.clone().text())) return res;
    nextSlot.set(path, Date.now() + retryMs + 150);
  }
  throw new Error(`${path} -> still 429 after 5 attempts`);
}

/** Distinguish "slow down" from "you are out of quota" — only one is retriable. */
function body429IsQuota(text) {
  return /REQUEST_LIMIT_EXCEEDED/i.test(text);
}

// --- instrument: /v4/account (unmetered) ----------------------------------

let accountPolls = 0;

async function readUsage() {
  const res = await paced("/v4/account");
  accountPolls += 1;
  if (!res.ok) {
    throw new Error(`/v4/account -> HTTP ${res.status} ${redact(await res.text())}`);
  }
  const body = await res.json();
  const sub =
    body.subscriptions?.find((s) => s.subscription_id === body.current_subscription_id) ||
    body.subscriptions?.find((s) => s.is_active) ||
    body.subscriptions?.[0];
  if (!sub) throw new Error("no subscription found on account payload");
  return {
    count: Number(sub.request_count),
    limit: Number(sub.request_limit),
    websocketAccess: sub.websocket_access,
    bookmakers: Object.keys(sub.bookmakers || {}),
    sportIds: sub.sport_ids,
    rateLimit: sub.rate_limit,
  };
}

/** A call we KNOW is billable, used as the positive control. */
async function billableCall() {
  const res = await paced("/v4/sports");
  return res.status;
}

// --- phase runner ---------------------------------------------------------

/**
 * Polls usage for `minutes`, invoking `onTick` after each poll. Returns the
 * first and last observed counts plus the full series.
 */
async function pollFor(label, minutes, onTick = () => {}) {
  const series = [];
  const deadline = Date.now() + minutes * 60_000;
  const first = await readUsage();
  series.push(first.count);
  console.log(`  ${stamp()}  ${label}: start request_count=${first.count}`);

  while (Date.now() < deadline) {
    await sleep(POLL_SECONDS * 1000);
    const now = await readUsage();
    series.push(now.count);
    onTick(now, now.count - first.count);
  }
  return { first: first.count, last: series[series.length - 1], series };
}

// --- socket ---------------------------------------------------------------

async function openSocket() {
  let Impl = globalThis.WebSocket;
  if (!Impl) ({ default: Impl } = await import("ws"));
  return new Impl(`${WS_BASE}?apiKey=${API_KEY}`);
}

async function main() {
  console.log("OddsPapi WebSocket quota probe");
  console.log("=".repeat(70));

  const acct = await readUsage();
  console.log(`host              ${BASE}`);
  console.log(`request_count     ${acct.count} / ${acct.limit}`);
  console.log(`websocket_access  ${acct.websocketAccess}`);
  console.log(`bookmakers        ${acct.bookmakers.join(", ") || "(none)"}`);
  console.log(`sport_ids         ${(acct.sportIds || []).join(", ")}`);
  console.log(`rate_limit        ${acct.rateLimit ?? "null"}`);
  console.log(
    `plan              idle ${IDLE_MINUTES}m -> control ${CONTROL_CALLS} calls -> socket ${SOCKET_MINUTES}m, polling every ${POLL_SECONDS}s`,
  );
  console.log("=".repeat(70));

  // -- Phase A: idle ------------------------------------------------------
  console.log("\n[A] IDLE — is the counter stable with no traffic from us?");
  const idle = await pollFor("idle", IDLE_MINUTES, (u, d) =>
    console.log(`  ${stamp()}  request_count=${u.count}  delta=${d >= 0 ? "+" : ""}${d}`),
  );
  const idleDrift = idle.last - idle.first;
  console.log(
    `  -> idle drift ${idleDrift >= 0 ? "+" : ""}${idleDrift} over ${IDLE_MINUTES}m ` +
      `(${accountPolls} /v4/account polls, expected free)`,
  );

  // -- Phase B: positive control -----------------------------------------
  console.log(`\n[B] CONTROL — ${CONTROL_CALLS} billable /v4/sports calls; counter must move.`);
  const beforeControl = (await readUsage()).count;
  for (let i = 0; i < CONTROL_CALLS; i += 1) {
    const status = await billableCall();
    console.log(`  ${stamp()}  /v4/sports -> ${status}`);
    await sleep(1100); // documented 1000ms cooldown
  }

  // The counter may lag; wait for it to reflect the control calls.
  let controlDelta = 0;
  let lagSeconds = 0;
  for (let i = 0; i < 12; i += 1) {
    await sleep(5000);
    lagSeconds += 5;
    controlDelta = (await readUsage()).count - beforeControl;
    if (controlDelta >= CONTROL_CALLS) break;
  }
  console.log(
    `  -> control delta +${controlDelta} (expected +${CONTROL_CALLS}), visible after ~${lagSeconds}s`,
  );

  const instrumentWorks = controlDelta >= CONTROL_CALLS;
  if (!instrumentWorks) {
    console.log(
      "  !! counter did not reflect known-billable calls — results below are NOT trustworthy",
    );
  }

  // -- Phase C: socket ----------------------------------------------------
  console.log(`\n[C] SOCKET — streaming for ${SOCKET_MINUTES}m while polling the counter.`);
  const ws = await openSocket();

  let messages = 0;
  let priceUpdates = 0;
  const fixtures = new Set();
  let firstMessageAt = null;
  let socketError = null;

  ws.onmessage = (ev) => {
    messages += 1;
    if (!firstMessageAt) firstMessageAt = Date.now();
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.fixtureId) fixtures.add(msg.fixtureId);
      if (msg.bookmakerOdds) priceUpdates += 1;
    } catch {
      /* non-JSON frame (heartbeat etc.) — still counts as a message */
    }
  };
  ws.onerror = (e) => {
    socketError = redact(e?.message || e?.type || "unknown");
  };
  ws.onclose = (e) => {
    console.log(`  ${stamp()}  socket closed (code=${e?.code ?? "?"})`);
  };

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket did not open within 20s")), 20_000);
    ws.onopen = () => {
      clearTimeout(timer);
      console.log(`  ${stamp()}  socket open`);
      resolve();
    };
  });

  const socketPhase = await pollFor("socket", SOCKET_MINUTES, (u, d) =>
    console.log(
      `  ${stamp()}  request_count=${u.count}  delta=${d >= 0 ? "+" : ""}${d}  ` +
        `msgs=${messages}  price_updates=${priceUpdates}  fixtures=${fixtures.size}`,
    ),
  );

  try {
    ws.close();
  } catch {
    /* already closed */
  }

  const socketDelta = socketPhase.last - socketPhase.first;

  // -- Verdict ------------------------------------------------------------
  console.log(`\n${"=".repeat(70)}`);
  console.log("RESULT");
  console.log("=".repeat(70));
  console.log(`messages received      ${messages}`);
  console.log(`  with price payloads  ${priceUpdates}`);
  console.log(`distinct fixtures      ${fixtures.size}`);
  console.log(`request_count delta    ${socketDelta >= 0 ? "+" : ""}${socketDelta}`);
  console.log(`/v4/account polls      ${accountPolls} (should not be billed)`);
  if (socketError) console.log(`socket error           ${socketError}`);

  const perMessage = messages > 0 ? (socketDelta / messages).toFixed(4) : "n/a";
  console.log(`implied cost/message   ${perMessage}`);
  console.log("-".repeat(70));

  if (!instrumentWorks) {
    console.log(
      "INCONCLUSIVE — the control calls did not register, so a flat counter\n" +
        "during the socket phase means nothing. Re-run, or ask support directly.",
    );
  } else if (messages === 0) {
    console.log(
      "INCONCLUSIVE — the socket delivered zero messages, so there was nothing\n" +
        "to bill. Re-run while soccer matches are in play (check liveFixtures\n" +
        "via /v4/tournaments first).",
    );
  } else if (socketDelta === 0) {
    console.log(
      `FREE — ${messages} messages arrived and request_count did not move.\n` +
        "The WebSocket does not consume quota. The plan's live-odds budget of\n" +
        "zero holds; only REST reseeds on reconnect are billable.",
    );
  } else if (socketDelta < messages * 0.5) {
    console.log(
      `PARTIAL — counter moved +${socketDelta} against ${messages} messages.\n` +
        "Messages are probably not billed 1:1; something else (the connection\n" +
        "itself, or a periodic charge) may be. Investigate before relying on it.",
    );
  } else {
    console.log(
      `BILLED — counter moved +${socketDelta} against ${messages} messages.\n` +
        "Treat streaming as metered and fall back to the polling ladder in\n" +
        "section 4.3 of the migration plan.",
    );
  }
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error(`\nprobe failed: ${redact(err.message)}`);
  process.exit(1);
});
