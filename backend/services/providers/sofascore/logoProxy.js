import { getRedisClient } from "../../cacheService.js";
import { fetchImage, parseLogoKind } from "./client.js";

const IMAGE_TTL = 7 * 86400;

function cacheKey(kind, id) {
  return `sofascore:img:${kind}:${id}`;
}

function metaKey(kind, id) {
  return `sofascore:img-meta:${kind}:${id}`;
}

function prefixed(key) {
  const prefix = process.env.REDIS_KEY_PREFIX
    ? `${process.env.REDIS_KEY_PREFIX}:`
    : "";
  return `${prefix}${key}`;
}

async function readCached(kind, id) {
  try {
    const redis = getRedisClient();
    const [buf, metaRaw] = await Promise.all([
      redis.getBuffer(prefixed(cacheKey(kind, id))),
      redis.get(prefixed(metaKey(kind, id))),
    ]);
    if (!buf || !buf.length) return null;
    let contentType = "image/png";
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw);
        if (meta?.contentType) contentType = meta.contentType;
      } catch {
        /* keep default */
      }
    }
    return { buf, contentType };
  } catch {
    return null;
  }
}

async function writeCached(kind, id, { buf, contentType }) {
  try {
    const redis = getRedisClient();
    await Promise.all([
      redis.set(prefixed(cacheKey(kind, id)), buf, "EX", IMAGE_TTL),
      redis.set(
        prefixed(metaKey(kind, id)),
        JSON.stringify({ contentType }),
        "EX",
        IMAGE_TTL,
      ),
    ]);
  } catch {
    /* cache write is optional */
  }
}

export async function serveSofascoreLogo(req, res) {
  const kind = parseLogoKind(req.params.kind);
  const id = Number(req.params.id);
  if (!kind || !Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ message: "invalid logo" });
  }

  const cached = await readCached(kind, id);
  if (cached) {
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Content-Type", cached.contentType);
    return res.send(cached.buf);
  }

  try {
    const image = await fetchImage(kind, id);
    await writeCached(kind, id, image);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Content-Type", image.contentType);
    return res.send(image.buf);
  } catch (err) {
    const status = Number(err.status) || 502;
    return res.status(status === 400 ? 400 : 502).json({
      message: "logo unavailable",
    });
  }
}
