import { Hono } from "hono";
import type { AppEnv } from "../types";

const decksRoute = new Hono<AppEnv>();

decksRoute.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, decklist, created_at FROM decks ORDER BY id",
  ).all();

  return c.json({ data: rows.results });
});

decksRoute.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, name, decklist, created_at FROM decks WHERE id = ?",
  )
    .bind(id)
    .first();

  if (!row) return c.json({ error: "Deck not found" }, 404);
  return c.json({ data: row });
});

export { decksRoute };
