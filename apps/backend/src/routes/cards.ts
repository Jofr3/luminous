import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const cardsRoute = new Hono<{ Bindings: Bindings }>();

cardsRoute.get("/", async (c) => {
  const q = c.req.query("q")?.trim() || "";
  const category = c.req.query("category")?.trim() || "";
  const set = c.req.query("set")?.trim() || "";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "40", 10) || 40, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

  const conditions: string[] = [];
  const params: string[] = [];

  if (q) {
    conditions.push("c.name LIKE ?");
    params.push(`%${q}%`);
  }
  if (category) {
    conditions.push("c.category = ?");
    params.push(category);
  }
  if (set) {
    conditions.push("c.set_id = ?");
    params.push(set);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM cards c ${where}`
  )
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.local_id, c.name, c.image, c.category, c.rarity, c.hp,
            c.set_id, s.name as set_name
     FROM cards c
     LEFT JOIN sets s ON c.set_id = s.id
     ${where}
     ORDER BY c.name ASC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  // Card data is static — cache aggressively
  c.header("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  return c.json({
    data: rows.results,
    total,
    hasMore: offset + rows.results.length < total,
  });
});

cardsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const card = await c.env.DB.prepare(
    `SELECT c.*, s.name as set_name, s.logo as set_logo, s.symbol as set_symbol,
            s.release_date as set_release_date
     FROM cards c
     LEFT JOIN sets s ON c.set_id = s.id
     WHERE c.id = ?`
  )
    .bind(id)
    .first();

  if (!card) {
    return c.json({ error: "Card not found" }, 404);
  }

  c.header("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  return c.json({ data: card });
});

export { cardsRoute };
