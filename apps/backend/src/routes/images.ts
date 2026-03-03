import { Hono } from "hono";
import type { AppEnv } from "../types";

const imagesRoute = new Hono<AppEnv>();

imagesRoute.get("/*", async (c) => {
  const key = c.req.path.replace(/^\/images\//, "");
  if (!key) {
    return c.json({ error: "Missing key" }, 400);
  }

  const cache = caches.default;
  const cacheKey = c.req.raw;

  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, cached);
  }

  const object = await c.env.IMAGES.get(key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  const headers = new Headers({
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=31536000, immutable",
    "ETag": object.etag,
  });

  const response = new Response(object.body, { headers });

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
});

export { imagesRoute };
