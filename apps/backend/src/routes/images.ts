import { Hono } from "hono";
import type { AppEnv } from "../types";

const imagesRoute = new Hono<AppEnv>();

imagesRoute.get("/*", async (c) => {
  const key = c.req.path.replace(/^\/images\//, "");
  if (!key) {
    return c.json({ error: "Missing key" }, 400);
  }

  const object = await c.env.IMAGES.get(key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("ETag", object.etag);

  return c.body(object.body);
});

export { imagesRoute };
