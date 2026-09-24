import WebSocket from "ws";
import { getCache, setCache } from "../../services/cacheService.js";
import {
  getOddspapiConfig,
  isOddspapiShadowEnabled,
  mapStatusId,
  oddspapiWsCacheKey,
  parseProviderFixtureId,
} from "../../services/providers/oddspapi/config.js";
import { mergeBookmakerOdds } from "../../services/providers/oddspapi/mergeBookmakerOdds.js";
import {
  mergeScorePeriods,
  normalizeScores,
  settlementScorePatch,
} from "../../services/providers/oddspapi/normalize.js";
import { liveScorePatch } from "../../services/providers/oddspapi/liveClock.js";
import prisma from "../../Config/db.js";
import { persistOddspapiRawOdds } from "./syncOdds.js";

const LIVE_TTL = 6 * 3600;
const PERSIST_MIN_MS = 8_000;

let socket = null;
let stopRequested = false;
let reconnectTimer = null;
let stats = { messages: 0, openedAt: null, lastMessageAt: null, reconnects: 0 };
const lastPersistAt = new Map();

/** Persist settlement scores from `fulltime`/`p1` and live display from `result`. */
function mergeScore(cached) {
  const scored = normalizeScores(cached);
  const patch = {
    ...settlementScorePatch(scored),
    ...liveScorePatch(scored),
  };
  return Object.keys(patch).length ? patch : null;
}

async function persistLiveOdds(existing, mergedOdds) {
  const now = Date.now();
  const prev = lastPersistAt.get(existing.id) || 0;
  if (now - prev < PERSIST_MIN_MS) return;
  lastPersistAt.set(existing.id, now);
  await persistOddspapiRawOdds(
    existing,
    { bookmakerOdds: mergedOdds },
    { pruneMissing: false },
  );
}

async function applyMessage(msg) {
  if (!msg?.fixtureId) return;
  const apiId = parseProviderFixtureId(msg.fixtureId);
  const cacheKey = oddspapiWsCacheKey(msg.fixtureId);
  const prev = (await getCache(cacheKey)) || {};
  const next = {
    ...prev,
    fixtureId: msg.fixtureId,
    updatedAt: msg.updatedAt || new Date().toISOString(),
  };
  if (msg.statusId != null) next.statusId = msg.statusId;
  if (msg.scores) next.scores = mergeScorePeriods(prev.scores, msg.scores);
  if (msg.bookmakerOdds) {
    next.bookmakerOdds = mergeBookmakerOdds(prev.bookmakerOdds, msg.bookmakerOdds);
  }
  await setCache(cacheKey, next, LIVE_TTL);

  if (apiId == null) return;
  const patch = {};
  if (msg.statusId != null) patch.status = mapStatusId(msg.statusId);
  if (msg.scores) {
    const score = mergeScore(next);
    if (score) Object.assign(patch, score);
  }

  const existing = await prisma.fixture.findUnique({
    where: { api_fixture_id: apiId },
    select: { id: true, provider: true },
  });
  if (!existing || existing.provider !== "oddspapi") return;

  if (Object.keys(patch).length) {
    await prisma.fixture.update({ where: { id: existing.id }, data: patch });
  }

  if (msg.bookmakerOdds) {
    persistLiveOdds(existing, next.bookmakerOdds).catch((err) => {
      console.warn("[oddspapi:ws] odds persist failed:", err.message);
    });
  }

  const nextStatus = patch.status;
  if (nextStatus === "FT" || nextStatus === "AET" || nextStatus === "CANC") {
    import("../../services/ticketSettlementService.js")
      .then(({ settleFixture }) => settleFixture(existing.id))
      .catch((err) => {
        console.warn("[oddspapi:ws] settle failed:", err.message);
      });
  }
}

function openSocket() {
  const cfg = getOddspapiConfig();
  if (!cfg.apiKey) {
    console.warn("[oddspapi:ws] missing ODDSPAPI_API_KEY");
    return null;
  }
  // Node 20 has no global WebSocket; the `ws` package does.
  return new WebSocket(`${cfg.wsUrl}?apiKey=${cfg.apiKey}`);
}

function scheduleReconnect(delayMs) {
  if (stopRequested) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    stats.reconnects += 1;
    connect().catch((err) => {
      console.error("[oddspapi:ws] reconnect failed:", err.message);
      scheduleReconnect(Math.min(30_000, delayMs * 2));
    });
  }, delayMs);
}

export async function connect() {
  if (!isOddspapiShadowEnabled() || !getOddspapiConfig().wsEnabled) return;
  stopRequested = false;
  const ws = openSocket();
  if (!ws) return;
  socket = ws;

  ws.on("open", () => {
    stats.openedAt = new Date().toISOString();
    console.log("[oddspapi:ws] connected (deltas only — REST reseed required after reconnect)");
  });
  ws.on("message", (data) => {
    stats.messages += 1;
    stats.lastMessageAt = new Date().toISOString();
    const raw = typeof data === "string" ? data : data?.toString?.();
    if (!raw || raw[0] !== "{") return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    applyMessage(msg).catch((err) => {
      console.warn("[oddspapi:ws] apply failed:", err.message);
    });
  });
  ws.on("close", () => {
    console.warn("[oddspapi:ws] closed");
    socket = null;
    if (!stopRequested) scheduleReconnect(2000);
  });
  ws.on("error", (err) => {
    console.warn("[oddspapi:ws] error:", err.message);
  });
}

export async function disconnect() {
  stopRequested = true;
  clearTimeout(reconnectTimer);
  try {
    socket?.close();
  } catch {
    /* ok */
  }
  socket = null;
}

export function websocketStats() {
  return { ...stats, connected: Boolean(socket) };
}
