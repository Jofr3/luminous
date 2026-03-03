import { Hono } from "hono";
import type { AppEnv } from "../types";

const setsRoute = new Hono<AppEnv>();

setsRoute.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.logo, s.symbol, s.card_count_total, s.card_count_official,
            s.release_date, s.series_id, se.name as series_name
     FROM sets s
     LEFT JOIN series se ON s.series_id = se.id
     ORDER BY s.release_date DESC`
  ).all();

  return c.json({ data: rows.results });
});

export { setsRoute };
