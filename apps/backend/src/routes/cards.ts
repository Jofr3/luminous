import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const cardsRoute = new Hono<{ Bindings: Bindings }>();

cardsRoute.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 40));
  const q = c.req.query("q")?.trim() || "";
  const category = c.req.query("category")?.trim() || "";
  const set = c.req.query("set")?.trim() || "";
  const offset = (page - 1) * limit;

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
    `SELECT COUNT(*) as total FROM cards c ${where}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const total = countResult?.total ?? 0;

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

  return c.json({
    data: rows.results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
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

  return c.json({ data: card });
});

export { cardsRoute };
