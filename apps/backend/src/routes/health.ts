import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const healthRoute = new Hono<{ Bindings: Bindings }>();

healthRoute.get("/", async (c) => {
  try {
    const result = await c.env.DB.prepare("SELECT 1 as ok").first();
    return c.json({ status: "ok", db: result ? "connected" : "error" });
  } catch {
    return c.json({ status: "ok", db: "unavailable" }, 200);
  }
});

export { healthRoute };
