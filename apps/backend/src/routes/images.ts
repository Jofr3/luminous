import { Hono } from "hono";
import type { AppEnv } from "../types";
import { getCorsOrigin } from "../lib/cors";

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

  const headers = new Headers();
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType || "application/octet-stream",
  );
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.etag);

  const origin = getCorsOrigin(c.req.header("Origin"), c.env);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  const response = new Response(object.body, { headers });

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
});

export { imagesRoute };
