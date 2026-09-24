import {
  COOLDOWN_MS,
  FREE_PATHS,
  getOddspapiConfig,
} from "./config.js";
import { recordBillable, writeMeta } from "./quota.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextSlot = new Map();
const consecutiveFailures = new Map();
const CIRCUIT_THRESHOLD = 8;
const CIRCUIT_COOLDOWN_MS = 60_000;
const circuitUntil = new Map();

export class OddspapiError extends Error {
  constructor(message, { path, status, code, body } = {}) {
    super(message);
    this.name = "OddspapiError";
    this.path = path;
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function asList(body) {
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

function errorCode(json) {
  return json?.error?.code || json?.code || null;
}

export async function oddspapiRequest(path, params = {}, { bucket = "other" } = {}) {
  const cfg = getOddspapiConfig();
  if (!cfg.apiKey) {
    throw new OddspapiError("ODDSPAPI_API_KEY is not set", { path });
  }

  const until = circuitUntil.get(path) || 0;
  if (Date.now() < until) {
    throw new OddspapiError(`circuit open for ${path}`, { path, code: "CIRCUIT_OPEN" });
  }

  const qs = new URLSearchParams();
  qs.set("apiKey", cfg.apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${cfg.baseUrl}${path}?${qs.toString()}`;
  const cooldown = COOLDOWN_MS[path] ?? 1000;
  const billed = !FREE_PATHS.has(path);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = (nextSlot.get(path) ?? 0) - Date.now();
    if (wait > 0) await sleep(wait);

    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      nextSlot.set(path, Date.now() + cooldown);
      bumpFailure(path);
      throw new OddspapiError(err.message, { path });
    }
    const ms = Date.now() - t0;
    const text = await res.text();
    nextSlot.set(path, Date.now() + cooldown);

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (res.status === 429) {
      const code = errorCode(json);
      if (code === "REQUEST_LIMIT_EXCEEDED") {
        if (billed) await recordBillable(bucket).catch(() => {});
        throw new OddspapiError("request limit exceeded", {
          path,
          status: 429,
          code,
          body: json,
        });
      }
      const retryMs =
        Number(json?.error?.retryMs ?? json?.retryMs) || cooldown;
      // Do not increment quota here: the 429 already counted if it reached
      // the endpoint. Waiting locally avoids a second billed retry storm;
      // we still retry once the server-asked delay has elapsed.
      nextSlot.set(path, Date.now() + retryMs + 50);
      if (billed) await recordBillable(bucket).catch(() => {});
      continue;
    }

    if (billed) await recordBillable(bucket).catch(() => {});

    if (path === "/v4/account" && json?.subscriptions) {
      const sub =
        json.subscriptions.find((s) => s.subscription_id === json.current_subscription_id) ||
        json.subscriptions.find((s) => s.is_active) ||
        json.subscriptions[0];
      await writeMeta(sub).catch(() => {});
    }

    if (res.status === 404 && errorCode(json) === "FIXTURE_NOT_FOUND") {
      clearFailure(path);
      return { status: 404, json, list: [], ms, empty: true };
    }

    if (!res.ok) {
      bumpFailure(path);
      throw new OddspapiError(
        `${path} HTTP ${res.status} ${errorCode(json) || ""}`.trim(),
        { path, status: res.status, code: errorCode(json), body: json },
      );
    }

    clearFailure(path);
    return { status: res.status, json, list: asList(json), ms, empty: false };
  }

  throw new OddspapiError(`${path} still 429 after retries`, { path, status: 429 });
}

function bumpFailure(path) {
  const n = (consecutiveFailures.get(path) || 0) + 1;
  consecutiveFailures.set(path, n);
  if (n >= CIRCUIT_THRESHOLD) {
    circuitUntil.set(path, Date.now() + CIRCUIT_COOLDOWN_MS);
    consecutiveFailures.set(path, 0);
    console.warn(`[oddspapi] circuit open for ${path} ${CIRCUIT_COOLDOWN_MS}ms`);
  }
}

function clearFailure(path) {
  consecutiveFailures.set(path, 0);
}
