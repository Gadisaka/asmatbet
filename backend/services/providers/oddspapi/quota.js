import { getRedisClient } from "../../cacheService.js";
import { getOddspapiConfig } from "./config.js";

const PREFIX = "oddspapi:quota";

function periodKey(validFrom) {
  return validFrom || "unknown";
}

export async function recordBillable(bucket = "other") {
  const redis = getRedisClient();
  const meta = await readMeta();
  const pk = periodKey(meta?.valid_from);
  const countKey = `${PREFIX}:${pk}:count`;
  const bucketKey = `${PREFIX}:${pk}:bucket:${bucket}`;
  const n = await redis.incr(countKey);
  await redis.incr(bucketKey);
  if (n === 1 && meta?.valid_until) {
    const ttl = Math.max(60, Math.floor((Date.parse(meta.valid_until) - Date.now()) / 1000) + 86400);
    await redis.expire(countKey, ttl);
    await redis.expire(bucketKey, ttl);
  }
  return n;
}

export async function readMeta() {
  try {
    const raw = await getRedisClient().get(`${PREFIX}:meta`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeMeta(sub) {
  if (!sub) return;
  const meta = {
    valid_from: sub.valid_from || null,
    valid_until: sub.valid_until || null,
    request_limit: Number(sub.request_limit) || getOddspapiConfig().monthlyLimit,
    request_count: Number(sub.request_count) || 0,
    websocket_access: sub.websocket_access,
    reconciled_at: new Date().toISOString(),
  };
  const ttl = meta.valid_until
    ? Math.max(60, Math.floor((Date.parse(meta.valid_until) - Date.now()) / 1000) + 86400)
    : 40 * 24 * 3600;
  await getRedisClient().set(`${PREFIX}:meta`, JSON.stringify(meta), "EX", ttl);
  return meta;
}

export async function getLocalCount() {
  const meta = await readMeta();
  const n = await getRedisClient().get(`${PREFIX}:${periodKey(meta?.valid_from)}:count`);
  return Number(n) || 0;
}

/**
 * Provider count wins when it is ahead of us (we missed increments). We never
 * wind the local counter backwards.
 */
export async function reconcileProviderCount(sub) {
  const meta = await writeMeta(sub);
  const redis = getRedisClient();
  const key = `${PREFIX}:${periodKey(meta.valid_from)}:count`;
  const local = Number(await redis.get(key)) || 0;
  const remote = Number(sub.request_count) || 0;
  if (remote > local) {
    await redis.set(key, String(remote));
  }
  return { local: Math.max(local, remote), remote, limit: meta.request_limit };
}

export async function quotaSnapshot() {
  const meta = await readMeta();
  const local = await getLocalCount();
  const limit = Number(meta?.request_limit) || getOddspapiConfig().monthlyLimit;
  const count = Math.max(local, Number(meta?.request_count) || 0);
  const start = meta?.valid_from ? Date.parse(meta.valid_from) : Date.now();
  const end = meta?.valid_until ? Date.parse(meta.valid_until) : start + 31 * 86400_000;
  const elapsed = Math.max(0, Date.now() - start);
  const total = Math.max(1, end - start);
  const expected = limit * (elapsed / total);
  const burnRatio = expected > 0 ? count / expected : 0;
  const remaining = Math.max(0, limit - count);
  let mode = "normal";
  if (count / limit >= 0.95) mode = "freeze";
  else if (burnRatio > 1.35) mode = "critical";
  else if (burnRatio > 1.15) mode = "conserve";
  else if (burnRatio >= 1.0) mode = "watch";
  return {
    count,
    limit,
    remaining,
    burnRatio,
    mode,
    valid_from: meta?.valid_from || null,
    valid_until: meta?.valid_until || null,
  };
}

export function allowOddsTier(mode, tier) {
  if (mode === "freeze") return false;
  if (mode === "critical" && tier === "cold") return false;
  if (mode === "critical" && tier === "warm") return false;
  return true;
}
