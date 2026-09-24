/**
 * Empirical answers for the remaining OddsPapi support questions.
 *
 * Hard-capped billable budget (default 40). `/v4/account` and
 * `/v4/historical-odds` are unmetered / free and do not count.
 *
 * Usage:
 *   ODDSPAPI_API_KEY=... node backend/scripts/oddspapiCalibrate.mjs
 */

const BASE = process.env.ODDSPAPI_BASE_URL || "https://api.oddspapi.io";
const WS_BASE = process.env.ODDSPAPI_WS_URL || "wss://api.oddspapi.io/v4/ws";
const API_KEY = process.env.ODDSPAPI_API_KEY;
const BOOKMAKER = process.env.ODDSPAPI_BOOKMAKER || "1xbet";
const SPORT_ID = String(process.env.ODDSPAPI_SPORT_ID || 10);
const MAX_BILLABLE = Number(process.env.ODDSPAPI_CALIBRATE_MAX || 40);

if (!API_KEY) {
  console.error("Missing ODDSPAPI_API_KEY");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).replaceAll(API_KEY, "***");
const stamp = () => new Date().toISOString().slice(11, 23);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const COOLDOWN_MS = {
  "/v4/account": 1000,
  "/v4/sports": 1000,
  "/v4/bookmakers": 1000,
  "/v4/tournaments": 1000,
  "/v4/fixtures": 2000,
  "/v4/fixture": 500,
  "/v4/markets": 1000,
  "/v4/participants": 1000,
  "/v4/odds": 500,
  "/v4/odds-by-tournaments": 1000,
  "/v4/historical-odds": 5000,
  "/v4/settlements": 2000,
  "/v4/scores": 1000,
};

const FREE_PATHS = new Set(["/v4/account", "/v4/historical-odds"]);
const nextSlot = new Map();
let billableUsed = 0;
const callLog = [];

class BudgetExhausted extends Error {
  constructor() {
    super(`billable budget exhausted (${MAX_BILLABLE})`);
  }
}

function asList(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    if (body.fixtureId) return [body];
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.fixtures)) return body.fixtures;
    const vals = Object.values(body);
    if (vals.length && vals.every((v) => v && typeof v === "object" && v.fixtureId)) {
      return vals;
    }
  }
  return [];
}

function collectMarketIdsFromOddsTree(fixtures) {
  const ids = new Set();
  const playerPropSeen = { yes: 0, no: 0 };
  for (const fx of fixtures) {
    const book = fx.bookmakerOdds?.[BOOKMAKER] || fx.bookmakers?.[BOOKMAKER];
    const markets = book?.markets || {};
    for (const [mid, market] of Object.entries(markets)) {
      ids.add(Number(mid));
      for (const outcome of Object.values(market.outcomes || {})) {
        for (const [pid, player] of Object.entries(outcome.players || {})) {
          if (pid !== "0" || player?.playerName) playerPropSeen.yes += 1;
          else playerPropSeen.no += 1;
        }
      }
    }
  }
  return { ids, playerPropSeen };
}

function collectSettlementIds(body) {
  const ids = new Set();
  const results = {};
  for (const [mid, market] of Object.entries(body?.markets || {})) {
    ids.add(Number(mid));
    for (const outcome of Object.values(market.outcomes || {})) {
      for (const player of Object.values(outcome.players || {})) {
        const r = player?.result;
        if (r) results[r] = (results[r] || 0) + 1;
      }
    }
  }
  return { ids, results };
}

async function request(path, params = {}, { retry = true } = {}) {
  const billed = !FREE_PATHS.has(path);
  if (billed && billableUsed >= MAX_BILLABLE) throw new BudgetExhausted();

  const qs = new URLSearchParams();
  qs.set("apiKey", API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${BASE}${path}?${qs.toString()}`;
  const urlBytes = Buffer.byteLength(url);
  const cooldown = COOLDOWN_MS[path] ?? 1000;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = (nextSlot.get(path) ?? 0) - Date.now();
    if (wait > 0) await sleep(wait);

    const t0 = Date.now();
    const res = await fetch(url);
    const ms = Date.now() - t0;
    const text = await res.text();
    nextSlot.set(path, Date.now() + cooldown);

    if (res.status === 429 && retry) {
      let retryMs = cooldown;
      try {
        const err = JSON.parse(text);
        retryMs = Number(err?.error?.retryMs ?? err?.retryMs) || cooldown;
        const code = err?.error?.code || err?.code;
        if (code === "REQUEST_LIMIT_EXCEEDED") {
          throw new Error("REQUEST_LIMIT_EXCEEDED — aborting");
        }
      } catch (e) {
        if (e.message?.startsWith("REQUEST_LIMIT")) throw e;
      }
      callLog.push({ path, status: 429, ms, billed: false, note: `retry ${retryMs}ms` });
      nextSlot.set(path, Date.now() + retryMs + 50);
      continue;
    }

    if (billed) billableUsed += 1;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    callLog.push({
      path,
      status: res.status,
      ms,
      bytes: text.length,
      billed,
      urlBytes,
    });
    return { res, json, text, ms, urlBytes };
  }
  throw new Error(`${path} still 429 after retries`);
}

async function readUsage() {
  const { json } = await request("/v4/account");
  const sub =
    json.subscriptions?.find((s) => s.subscription_id === json.current_subscription_id) ||
    json.subscriptions?.find((s) => s.is_active) ||
    json.subscriptions?.[0];
  return { raw: json, sub, count: Number(sub.request_count), limit: Number(sub.request_limit) };
}

function isoMinutesAgo(mins) {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

function isoHoursAgo(h) {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function isoHoursAhead(h) {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

async function openSocket() {
  let Impl = globalThis.WebSocket;
  if (!Impl) ({ default: Impl } = await import("ws"));
  return new Impl(`${WS_BASE}?apiKey=${API_KEY}`);
}

function attachSocket(ws, label, stats) {
  const firstTen = [];
  ws.onmessage = (ev) => {
    stats.messages += 1;
    const raw = typeof ev.data === "string" ? ev.data : ev.data.toString();
    stats.bytes += raw.length;
    let msg = null;
    try {
      msg = JSON.parse(raw);
    } catch {
      stats.nonJson += 1;
      return;
    }
    if (msg.fixtureId) stats.fixtures.add(msg.fixtureId);
    if (msg.bookmakerOdds) stats.odds += 1;
    if (msg.statusId !== undefined) stats.status += 1;
    if (msg.scores) stats.scores += 1;
    if (firstTen.length < 8) {
      firstTen.push({
        fixtureId: msg.fixtureId,
        keys: Object.keys(msg).sort(),
        markets: Object.keys(msg.bookmakerOdds?.[Object.keys(msg.bookmakerOdds || {})[0]]?.markets || {}).length,
        statusId: msg.statusId,
      });
    }
  };
  ws.onerror = (e) => {
    stats.error = redact(e?.message || e?.type || "error");
  };
  ws.onclose = (e) => {
    stats.closeCode = e?.code;
  };
  stats.firstTen = firstTen;
  stats.label = label;
}

function waitOpen(ws, ms = 15_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("socket open timeout")), ms);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

// ---------------------------------------------------------------------------

const report = [];
function h(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
  report.push(`\n## ${title}`);
}
function line(s) {
  console.log(`  ${s}`);
  report.push(s);
}

async function main() {
  console.log("OddsPapi calibration");
  console.log(`budget ${MAX_BILLABLE} billable calls · bookmaker=${BOOKMAKER} · sportId=${SPORT_ID}`);

  const start = await readUsage();
  line(
    `account start: ${start.count}/${start.limit}  valid_from=${start.sub.valid_from}  valid_until=${start.sub.valid_until}  created=${start.sub.created_at}  ws=${start.sub.websocket_access}  rate_limit=${start.sub.rate_limit}`,
  );
  line(
    `bookmakers: ${JSON.stringify(start.sub.bookmakers)}  sport_ids=${JSON.stringify(start.sub.sport_ids)}`,
  );

  // 5a — subscription period shape
  h("5a. Quota period (from account payload, not a month-end wait)");
  const vf = start.sub.valid_from ? new Date(start.sub.valid_from) : null;
  if (vf) {
    const isFirst = vf.getUTCDate() === 1 && vf.getUTCHours() === 0;
    line(`valid_from=${start.sub.valid_from}  valid_until=${start.sub.valid_until}`);
    line(
      isFirst
        ? "Looks like a calendar-month boundary (day 1 00:00 UTC)."
        : "Does NOT look like a calendar-month reset — valid_from is mid-period. Reset is likely rolling from subscription start. Confirm on the 1st vs on the anniversary of valid_from.",
    );
  }

  // Catalogue
  h("Catalogue: tournaments + markets");
  const tRes = await request("/v4/tournaments", { sportId: SPORT_ID });
  const tournaments = asList(tRes.json);
  const liveTs = tournaments.filter((t) => t.liveFixtures > 0);
  const upTs = tournaments.filter((t) => t.upcomingFixtures > 0);
  const emptyTs = tournaments.filter(
    (t) => !t.liveFixtures && !t.upcomingFixtures && !t.futureFixtures,
  );
  line(
    `tournaments=${tournaments.length}  live=${liveTs.length} (${liveTs.reduce((n, t) => n + t.liveFixtures, 0)} fx)  upcoming=${upTs.length}  empty=${emptyTs.length}  ${tRes.ms}ms ${kb(tRes.text.length)}`,
  );

  const mRes = await request("/v4/markets", { language: "en" });
  const markets = asList(mRes.json);
  const soccerMarkets = markets.filter((m) => m.sportId === Number(SPORT_ID) || m.sportId == null);
  const propMarkets = soccerMarkets.filter((m) => m.playerProp);
  const byType = {};
  for (const m of soccerMarkets) {
    const k = m.marketType || "?";
    byType[k] = (byType[k] || 0) + 1;
  }
  line(
    `markets total=${markets.length} soccerish=${soccerMarkets.length} playerProp=${propMarkets.length}  types=${JSON.stringify(byType)}  ${mRes.ms}ms ${kb(mRes.text.length)}`,
  );

  // 6 — rate limits: parallel same vs different endpoints
  h("6. Rate limits: per-endpoint vs aggregate");
  await sleep(1200);
  const parallelSame = await Promise.allSettled([
    request("/v4/sports", {}, { retry: false }),
    request("/v4/sports", {}, { retry: false }),
  ]);
  const sameStatuses = parallelSame.map((p) =>
    p.status === "fulfilled" ? p.value.res.status : p.reason?.message,
  );
  line(`two /v4/sports in parallel → ${JSON.stringify(sameStatuses)}  (429 on one ⇒ per-endpoint cooldown)`);

  await sleep(1200);
  const parallelDiff = await Promise.allSettled([
    request("/v4/bookmakers", {}, { retry: false }),
    request("/v4/languages", {}, { retry: false }),
  ]);
  const diffStatuses = parallelDiff.map((p) =>
    p.status === "fulfilled" ? p.value.res.status : p.reason?.message,
  );
  line(
    ` /v4/bookmakers + /v4/languages in parallel → ${JSON.stringify(diffStatuses)}  (both 200 ⇒ cooldowns are independent, no aggregate ceiling at this volume)`,
  );

  // 2a/2b — batch size. Use empty tournaments first so payload isn't the limiter.
  h("2a/2b. odds-by-tournaments batch size and truncation");
  const emptyIds = emptyTs.map((t) => t.tournamentId);
  const busyIds = [...liveTs, ...upTs]
    .map((t) => t.tournamentId)
    .filter((id, i, a) => a.indexOf(id) === i);

  async function oddsBatch(ids, extra = {}) {
    const joined = ids.join(",");
    const r = await request("/v4/odds-by-tournaments", {
      tournamentIds: joined,
      bookmakers: BOOKMAKER,
      ...extra,
    });
    const list = asList(r.json);
    const err = r.json?.error || r.json?.message || r.json?.code;
    return {
      status: r.res.status,
      ms: r.ms,
      bytes: r.text.length,
      urlBytes: r.urlBytes,
      count: list.length,
      err: err ? JSON.stringify(err).slice(0, 240) : null,
      list,
    };
  }

  const sizes = [1, 25, 100, 400, 800];
  if (emptyIds.length >= 1200) sizes.push(1200);

  let maxOkEmpty = 0;
  let firstFail = null;
  for (const n of sizes) {
    if (n > emptyIds.length) break;
    const r = await oddsBatch(emptyIds.slice(0, n));
    const tag = r.err ? ` ERR ${r.err}` : "";
    line(
      `empty ids n=${n}  HTTP ${r.status}  fixtures=${r.count}  body=${kb(r.bytes)}  url=${kb(r.urlBytes)}  ${r.ms}ms${tag}`,
    );
    if (r.status >= 200 && r.status < 300 && !r.err) maxOkEmpty = n;
    else {
      firstFail = { n, ...r };
      break;
    }
  }

  // If everything succeeded, try ALL empty ids (URL-length test).
  if (!firstFail && emptyIds.length > sizes[sizes.length - 1]) {
    const r = await oddsBatch(emptyIds);
    line(
      `empty ids n=${emptyIds.length} (all empty)  HTTP ${r.status}  fixtures=${r.count}  body=${kb(r.bytes)}  url=${kb(r.urlBytes)}  ${r.ms}ms ${r.err || ""}`,
    );
    if (r.status >= 200 && r.status < 300 && !r.err) maxOkEmpty = emptyIds.length;
    else firstFail = { n: emptyIds.length, ...r };
  }

  line(`max accepted empty-tournament id list: ${maxOkEmpty}${firstFail ? `  first fail n=${firstFail.n} HTTP ${firstFail.status}` : "  (no failure found)"}`);

  // Payload / truncation on BUSY tournaments
  const payloadSizes = [1, 5, 10].filter((n) => n <= busyIds.length);
  const busyResults = [];
  for (const n of payloadSizes) {
    const r = await oddsBatch(busyIds.slice(0, n));
    const { ids, playerPropSeen } = collectMarketIdsFromOddsTree(r.list);
    const statusMix = {};
    for (const fx of r.list) {
      statusMix[fx.statusId] = (statusMix[fx.statusId] || 0) + 1;
    }
    line(
      `busy ids n=${n}  HTTP ${r.status}  fixtures=${r.count}  markets=${ids.size}  statusMix=${JSON.stringify(statusMix)}  props(non0)=${playerPropSeen.yes}  body=${kb(r.bytes)}  ${r.ms}ms ${r.err || ""}`,
    );
    busyResults.push({ n, ...r, marketIds: ids, playerPropSeen, statusMix });
  }

  // Compare odds-by-tournaments fixture count vs /v4/fixtures for one busy tournament
  if (busyIds[0] != null) {
    const tid = busyIds[0];
    const fxr = await request("/v4/fixtures", { tournamentId: tid });
    const fxList = asList(fxr.json);
    const oddsOne = busyResults.find((b) => b.n === 1);
    line(
      `tournament ${tid}: /v4/fixtures=${fxList.length} (hasOdds=${fxList.filter((f) => f.hasOdds).length}) vs odds-by-tournaments n=1 → ${oddsOne?.count ?? "n/a"} fixtures`,
    );
    if (oddsOne && fxList.length > oddsOne.count + 2) {
      line(
        "odds-by-tournaments returns a SUBSET of /v4/fixtures (likely current/odds-bearing only) — not a truncation bug, but do not treat it as a full fixture catalogue.",
      );
    }
  }

  // 2c verbosity
  h("2c. verbosity parameter");
  if (busyIds.length) {
    const ids = busyIds.slice(0, 3);
    const v1 = await oddsBatch(ids, { verbosity: 1 });
    const v3 = await oddsBatch(ids, { verbosity: 3 });
    const sample = (list) => {
      const fx = list[0];
      const book = fx?.bookmakerOdds?.[BOOKMAKER];
      const mid = Object.keys(book?.markets || {})[0];
      const market = book?.markets?.[mid];
      const oid = Object.keys(market?.outcomes || {})[0];
      const player = market?.outcomes?.[oid]?.players?.["0"];
      return {
        fixtureKeys: fx ? Object.keys(fx).sort() : [],
        playerKeys: player ? Object.keys(player).sort() : [],
        hasExternal: Boolean(fx?.externalProviders),
        hasNames: Boolean(fx?.participant1Name),
        priceAmerican: player?.priceAmerican ?? null,
      };
    };
    const a = sample(v1.list);
    const b = sample(v3.list);
    line(`verbosity=1  HTTP ${v1.status} body=${kb(v1.bytes)} fixtures=${v1.count} ${v1.ms}ms  fixtureKeys=${a.fixtureKeys.join(",")}`);
    line(`             playerKeys=${a.playerKeys.join(",")}  names=${a.hasNames}  external=${a.hasExternal}  priceAmerican=${a.priceAmerican}`);
    line(`verbosity=3  HTTP ${v3.status} body=${kb(v3.bytes)} fixtures=${v3.count} ${v3.ms}ms  fixtureKeys=${b.fixtureKeys.join(",")}`);
    line(`             playerKeys=${b.playerKeys.join(",")}  names=${b.hasNames}  external=${b.hasExternal}  priceAmerican=${b.priceAmerican}`);
    const sizeRatio = v1.bytes ? (v3.bytes / v1.bytes).toFixed(2) : "n/a";
    const extraKeys = b.playerKeys.filter((k) => !a.playerKeys.includes(k));
    const extraFx = b.fixtureKeys.filter((k) => !a.fixtureKeys.includes(k));
    line(
      extraKeys.length || extraFx.length || v3.bytes !== v1.bytes
        ? `verbosity changes payload (v3/v1 size=${sizeRatio}x). extra fixture keys=[${extraFx}] extra player keys=[${extraKeys}]`
        : "verbosity did not change size or keys on this sample — may be ignored for this bookmaker/plan.",
    );
  }

  // 3a 1xbet market coverage from the busiest batch we already fetched
  h("3a. 1xBet soccer market coverage (from live/upcoming batches)");
  const union = new Set();
  let propHits = 0;
  for (const b of busyResults) {
    for (const id of b.marketIds) union.add(id);
    propHits += b.playerPropSeen.yes;
  }
  const soccerIds = new Set(soccerMarkets.map((m) => m.marketId));
  const named = [...union]
    .sort((a, b) => a - b)
    .map((id) => {
      const m = soccerMarkets.find((x) => x.marketId === id);
      return m
        ? `${id}:${m.marketName} [${m.marketType}/${m.period}]`
        : `${id}:UNNAMED`;
    });
  line(`unique 1xbet marketIds seen=${union.size}  of soccer catalogue=${soccerIds.size}  player-level (pid≠0) prices=${propHits}`);
  line(`offered: ${named.slice(0, 80).join(" | ")}${named.length > 80 ? " | …" : ""}`);
  const missingNamed = soccerMarkets
    .filter((m) => !union.has(m.marketId) && !m.playerProp)
    .slice(0, 40)
    .map((m) => `${m.marketId}:${m.marketName}`);
  line(`catalogue soccer non-prop NOT seen in this sample (first 40): ${missingNamed.join(" | ") || "(none)"}`);
  line(
    propHits === 0
      ? "No player-prop prices observed — consistent with has_player_props=false."
      : "Player-prop prices WERE observed despite has_player_props=false — re-check.",
  );

  // Fixtures windows + finished/cancelled samples
  h("Fixtures windows, finished + cancelled samples");
  const fin = await request("/v4/fixtures", {
    sportId: SPORT_ID,
    from: isoHoursAgo(36),
    to: isoHoursAhead(1),
    statusId: 2,
  });
  const finished = asList(fin.json).sort(
    (a, b) => new Date(b.trueEndTime || b.startTime) - new Date(a.trueEndTime || a.startTime),
  );
  line(`finished last ~36h: ${finished.length}  ${fin.ms}ms ${kb(fin.text.length)}`);

  const can = await request("/v4/fixtures", {
    sportId: SPORT_ID,
    from: isoHoursAgo(36),
    to: isoHoursAhead(1),
    statusId: 3,
  });
  const cancelled = asList(can.json);
  line(`cancelled last ~36h: ${cancelled.length}`);

  // date-window rejection
  try {
    const wide = await request("/v4/fixtures", {
      sportId: SPORT_ID,
      from: isoHoursAgo(24 * 12),
      to: new Date().toISOString(),
    });
    line(
      `12-day sportId window: HTTP ${wide.res.status} n=${asList(wide.json).length} ${wide.json?.error || wide.json?.message || wide.json?.code || ""}`,
    );
  } catch (e) {
    line(`12-day window failed: ${redact(e.message)}`);
  }

  // 4a/4b/4d settlements
  h("4. Settlements coverage, freshness, cancelled");
  const pickRecent = finished.filter((f) => {
    const end = new Date(f.trueEndTime || f.startTime).getTime();
    return Date.now() - end < 3 * 3600_000;
  });
  const pickMid = finished.filter((f) => {
    const end = new Date(f.trueEndTime || f.startTime).getTime();
    const age = Date.now() - end;
    return age >= 6 * 3600_000 && age < 24 * 3600_000;
  });
  const samples = [
    ...pickRecent.slice(0, 3),
    ...pickMid.slice(0, 2),
    ...finished.slice(0, 2),
  ].filter((f, i, a) => a.findIndex((x) => x.fixtureId === f.fixtureId) === i)
    .slice(0, 6);

  line(`settlement samples: ${samples.length} finished, cancelled available=${cancelled.length}`);

  for (const fx of samples) {
    const ageMin = Math.round(
      (Date.now() - new Date(fx.trueEndTime || fx.startTime).getTime()) / 60000,
    );
    const s = await request("/v4/settlements", { fixtureId: fx.fixtureId });
    const { ids, results } = collectSettlementIds(s.json);
    const undecided = results.UNDECIDED || 0;
    const decided = Object.entries(results)
      .filter(([k]) => k !== "UNDECIDED")
      .reduce((n, [, v]) => n + v, 0);

    // free historical-odds for coverage compare
    let histIds = new Set();
    try {
      const hres = await request("/v4/historical-odds", {
        fixtureId: fx.fixtureId,
        bookmakers: BOOKMAKER,
      });
      const book = hres.json?.bookmakers?.[BOOKMAKER] || hres.json?.bookmakers;
      const markets = book?.markets || {};
      histIds = new Set(Object.keys(markets).map(Number));
    } catch (e) {
      line(`  hist-odds ${fx.fixtureId} failed: ${redact(e.message)}`);
    }

    const onlySettle = [...ids].filter((id) => !histIds.has(id));
    const onlyHist = [...histIds].filter((id) => !ids.has(id));
    line(
      `  ${fx.fixtureId}  ${fx.tournamentName || fx.tournamentId}  age≈${ageMin}m  HTTP ${s.res.status}  settleMarkets=${ids.size}  results=${JSON.stringify(results)}  histMarkets=${histIds.size}  onlySettle=${onlySettle.length}  onlyHist=${onlyHist.length}`,
    );
    if (onlyHist.length && onlyHist.length <= 12) {
      line(`    priced but not settled: ${onlyHist.join(",")}`);
    }
    if (undecided && !decided) {
      line(`    ALL UNDECIDED at age≈${ageMin}m — settlements lag after FT`);
    }
  }

  for (const fx of cancelled.slice(0, 2)) {
    const s = await request("/v4/settlements", { fixtureId: fx.fixtureId });
    const { ids, results } = collectSettlementIds(s.json);
    const keys = Object.keys(results);
    const allCancelled = keys.length === 0 || keys.every((k) => k === "CANCELLED");
    line(
      `  CANCELLED ${fx.fixtureId}  HTTP ${s.res.status}  markets=${ids.size}  results=${JSON.stringify(results)}  allCancelled=${allCancelled}`,
    );
  }

  if (samples[0]) {
    const sc = await request("/v4/scores", { fixtureId: samples[0].fixtureId });
    line(
      `scores sample ${samples[0].fixtureId}: HTTP ${sc.res.status} periods=${Object.keys(sc.json?.scores || {}).join(",")}`,
    );
  }

  // 5b counter lag vs our billableUsed
  const mid = await readUsage();
  line(
    `quota check: local billableUsed=${billableUsed}  provider request_count ${start.count} → ${mid.count} (Δ ${mid.count - start.count})`,
  );

  // WebSocket 1b/1c/1d
  h("1b/1c/1d. WebSocket concurrency, reconnect, frames");
  const s1 = {
    messages: 0,
    bytes: 0,
    odds: 0,
    status: 0,
    scores: 0,
    nonJson: 0,
    fixtures: new Set(),
  };
  const s2 = {
    messages: 0,
    bytes: 0,
    odds: 0,
    status: 0,
    scores: 0,
    nonJson: 0,
    fixtures: new Set(),
  };
  const ws1 = await openSocket();
  const ws2 = await openSocket();
  attachSocket(ws1, "a", s1);
  attachSocket(ws2, "b", s2);
  await Promise.all([waitOpen(ws1), waitOpen(ws2)]);
  line(`${stamp()} two sockets open`);
  await sleep(25_000);
  line(
    `concurrent 25s: A msgs=${s1.messages} fx=${s1.fixtures.size} odds=${s1.odds} status=${s1.status} scores=${s1.scores} nonJson=${s1.nonJson} close=${s1.closeCode || "open"}`,
  );
  line(
    `                 B msgs=${s2.messages} fx=${s2.fixtures.size} odds=${s2.odds} status=${s2.status} scores=${s2.scores} nonJson=${s2.nonJson} close=${s2.closeCode || "open"}`,
  );
  const overlap = [...s1.fixtures].filter((id) => s2.fixtures.has(id)).length;
  line(
    `fixture overlap A∩B=${overlap}  (high overlap ⇒ both sockets get the global feed, no subscribe needed)`,
  );
  line(`A first messages: ${JSON.stringify(s1.firstTen)}`);

  // reconnect: close A, reopen, compare first 12s
  try {
    ws1.close();
  } catch {
    /* ok */
  }
  await sleep(500);
  const s3 = {
    messages: 0,
    bytes: 0,
    odds: 0,
    status: 0,
    scores: 0,
    nonJson: 0,
    fixtures: new Set(),
  };
  const ws3 = await openSocket();
  attachSocket(ws3, "reconnect", s3);
  await waitOpen(ws3);
  await sleep(12_000);
  line(
    `reconnect 12s: msgs=${s3.messages} fx=${s3.fixtures.size} odds=${s3.odds}  first=${JSON.stringify(s3.firstTen)}`,
  );
  const reconnectLooksLikeSnapshot =
    s3.messages > 20 && s3.firstTen.some((m) => m.markets >= 3);
  line(
    reconnectLooksLikeSnapshot
      ? "Reconnect delivered a dense burst with multi-market payloads — looks like a snapshot/resync on connect."
      : "Reconnect delivered sparse/partial messages — treat as deltas only; REST-reseed after reconnect is required.",
  );

  // idle: keep ws2 quiet... we still receive. Watch ping: ws ping frames aren't in onmessage for the ws package the same way.
  // Document that we saw no non-JSON frames (likely no app-level heartbeat).
  line(
    `non-JSON frames on A/B: ${s1.nonJson + s2.nonJson}  (0 ⇒ no app-level heartbeat; TCP/ws ping may still exist below onmessage)`,
  );

  try {
    ws2.close();
    ws3.close();
  } catch {
    /* ok */
  }

  const end = await readUsage();
  h("Quota accounting");
  line(`local billableUsed=${billableUsed}/${MAX_BILLABLE}`);
  line(`provider request_count ${start.count} → ${end.count}  Δ=${end.count - start.count}`);
  line(`calls: ${callLog.map((c) => `${c.path}:${c.status}${c.billed ? "" : "*"}`).join(" ")}`);
  line(
    "UNTESTABLE here: 4c (settlement mutations over days), 5c (whether quota-429 is billed — would require exhausting 500k), 1d idle-timeout (needs a long silent wait).",
  );

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(`\ncalibration failed: ${redact(err.message)}`);
  console.error(`billableUsed=${billableUsed}`);
  process.exit(1);
});
