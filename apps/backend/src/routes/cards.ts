import { Hono } from "hono";
import type { AppEnv } from "../types";

const cardsRoute = new Hono<AppEnv>();

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseIntegerParam(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Reconstruct the original damage value (number | string) from damage_raw */
function reconstructDamage(raw: string): string | number | undefined {
  if (!raw) return undefined;
  const num = parseInt(raw, 10);
  if (!isNaN(num) && String(num) === raw) return num;
  return raw;
}

/** Group an array of rows by a string key */
function groupBy<T extends Record<string, unknown>>(rows: T[], key: keyof T): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = String(row[key]);
    const arr = map.get(k);
    if (arr) arr.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Build attack objects matching original API shape */
function assembleAttacks(rows: any[]): any[] {
  return rows.map((r) => {
    const attack: Record<string, unknown> = {
      cost: safeJsonParse(r.cost, []),
      name: r.name,
    };
    const damage = reconstructDamage(r.damage_raw);
    if (damage !== undefined) attack.damage = damage;
    if (r.effect != null) attack.effect = r.effect;
    return attack;
  });
}

/** Attach related data (attacks, abilities, types, modifiers) to a card row */
function assembleCard(
  card: Record<string, unknown>,
  attacks: any[],
  abilities: any[],
  modifiers: any[],
  types: any[],
): Record<string, unknown> {
  return {
    ...card,
    types: types.map((t: any) => t.type),
    attacks: assembleAttacks(attacks),
    abilities: abilities.map((a: any) => ({ type: a.type, name: a.name, effect: a.effect })),
    weaknesses: modifiers
      .filter((m: any) => m.kind === "weakness")
      .map((m: any) => ({ type: m.type, value: m.value })),
    resistances: modifiers
      .filter((m: any) => m.kind === "resistance")
      .map((m: any) => ({ type: m.type, value: m.value })),
  };
}

// ---------------------------------------------------------------------------
// GET /filters
// ---------------------------------------------------------------------------

cardsRoute.get("/filters", async (c) => {
  const db = c.env.DB;

  const [
    categories,
    rarities,
    stages,
    trainerTypes,
    energyTypes,
    types,
    weaknesses,
    resistances,
    retreats,
    hpRange,
    regulationMarks,
  ] = await Promise.all([
    db.prepare("SELECT DISTINCT category FROM cards WHERE category IS NOT NULL ORDER BY category").all(),
    db.prepare("SELECT DISTINCT rarity FROM cards WHERE rarity IS NOT NULL ORDER BY rarity").all(),
    db.prepare("SELECT DISTINCT stage FROM cards WHERE stage IS NOT NULL ORDER BY stage").all(),
    db.prepare("SELECT DISTINCT trainer_type FROM cards WHERE trainer_type IS NOT NULL ORDER BY trainer_type").all(),
    db.prepare("SELECT DISTINCT energy_type FROM cards WHERE energy_type IS NOT NULL ORDER BY energy_type").all(),
    db.prepare("SELECT DISTINCT type FROM card_types ORDER BY type").all(),
    db.prepare("SELECT DISTINCT type FROM card_type_modifiers WHERE kind = 'weakness' ORDER BY type").all(),
    db.prepare("SELECT DISTINCT type FROM card_type_modifiers WHERE kind = 'resistance' ORDER BY type").all(),
    db.prepare("SELECT DISTINCT retreat FROM cards WHERE retreat IS NOT NULL ORDER BY retreat").all(),
    db.prepare("SELECT MIN(CAST(hp AS INTEGER)) as min, MAX(CAST(hp AS INTEGER)) as max FROM cards WHERE hp IS NOT NULL").first<{ min: number; max: number }>(),
    db.prepare("SELECT DISTINCT regulation_mark FROM cards WHERE regulation_mark IS NOT NULL ORDER BY regulation_mark").all(),
  ]);

  c.header("Cache-Control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400");

  return c.json({
    categories: categories.results.map((r) => r.category),
    rarities: rarities.results.map((r) => r.rarity),
    stages: stages.results.map((r) => r.stage),
    trainer_types: trainerTypes.results.map((r) => r.trainer_type),
    energy_types: energyTypes.results.map((r) => r.energy_type),
    types: types.results.map((r) => r.type),
    weaknesses: weaknesses.results.map((r) => r.type),
    resistances: resistances.results.map((r) => r.type),
    retreats: retreats.results.map((r) => r.retreat),
    hp: { min: hpRange?.min ?? 0, max: hpRange?.max ?? 0 },
    regulation_marks: regulationMarks.results.map((r) => r.regulation_mark),
  });
});

// ---------------------------------------------------------------------------
// GET / (list)
// ---------------------------------------------------------------------------

cardsRoute.get("/", async (c) => {
  const db = c.env.DB;

  const q = c.req.query("q")?.trim() || "";
  const category = c.req.query("category")?.trim() || "";
  const set = c.req.query("set")?.trim() || "";
  const rarity = c.req.query("rarity")?.trim() || "";
  const stage = c.req.query("stage")?.trim() || "";
  const trainerType = c.req.query("trainer_type")?.trim() || "";
  const energyType = c.req.query("energy_type")?.trim() || "";
  const retreat = c.req.query("retreat")?.trim() || "";
  const hpMin = c.req.query("hp_min")?.trim() || "";
  const hpMax = c.req.query("hp_max")?.trim() || "";
  const legalStandard = c.req.query("legal_standard")?.trim() || "";
  const legalExpanded = c.req.query("legal_expanded")?.trim() || "";
  const typesParam = c.req.query("types")?.trim() || "";
  const weaknessParam = c.req.query("weakness")?.trim() || "";
  const resistanceParam = c.req.query("resistance")?.trim() || "";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "40", 10) || 40, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

  const conditions: string[] = [];
  const params: (string | number)[] = [];

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
  if (rarity) {
    conditions.push("c.rarity = ?");
    params.push(rarity);
  }
  if (stage) {
    conditions.push("c.stage = ?");
    params.push(stage);
  }
  if (trainerType) {
    conditions.push("c.trainer_type = ?");
    params.push(trainerType);
  }
  if (energyType) {
    conditions.push("c.energy_type = ?");
    params.push(energyType);
  }
  if (retreat) {
    conditions.push("c.retreat = ?");
    params.push(retreat);
  }
  const hpMinValue = parseIntegerParam(hpMin);
  if (hpMinValue !== null) {
    conditions.push("CAST(c.hp AS INTEGER) >= ?");
    params.push(hpMinValue);
  }
  const hpMaxValue = parseIntegerParam(hpMax);
  if (hpMaxValue !== null) {
    conditions.push("CAST(c.hp AS INTEGER) <= ?");
    params.push(hpMaxValue);
  }
  if (legalStandard) {
    conditions.push("c.legal_standard = 1");
  }
  if (legalExpanded) {
    conditions.push("c.legal_expanded = 1");
  }
  if (typesParam) {
    const values = typesParam.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) {
      const orClauses = values.map(() => "EXISTS (SELECT 1 FROM card_types ct WHERE ct.card_id = c.id AND ct.type = ?)");
      conditions.push(`(${orClauses.join(" OR ")})`);
      params.push(...values);
    }
  }
  if (weaknessParam) {
    const values = weaknessParam.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) {
      const orClauses = values.map(() => "EXISTS (SELECT 1 FROM card_type_modifiers m WHERE m.card_id = c.id AND m.kind = 'weakness' AND m.type = ?)");
      conditions.push(`(${orClauses.join(" OR ")})`);
      params.push(...values);
    }
  }
  if (resistanceParam) {
    const values = resistanceParam.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) {
      const orClauses = values.map(() => "EXISTS (SELECT 1 FROM card_type_modifiers m WHERE m.card_id = c.id AND m.kind = 'resistance' AND m.type = ?)");
      conditions.push(`(${orClauses.join(" OR ")})`);
      params.push(...values);
    }
  }

  const filters = conditions.length > 0 ? ` AND ${conditions.join(" AND ")}` : "";

  const countResult = await db.prepare(
    `SELECT COUNT(*) as count FROM cards c WHERE c.image IS NOT NULL AND c.image != ''${filters}`
  )
    .bind(...params)
    .first<{ count: number }>();

  const total = countResult?.count ?? 0;

  const rows = await db.prepare(
    `SELECT c.id, c.local_id, c.name, c.image, c.category, c.rarity, c.hp,
            c.stage, c.trainer_type, c.energy_type, c.suffix, c.retreat, c.effect,
            c.evolve_from, c.set_id, s.name as set_name
     FROM cards c
     LEFT JOIN sets s ON c.set_id = s.id
     WHERE c.image IS NOT NULL AND c.image != ''${filters}
     ORDER BY c.name ASC, c.id ASC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all();

  const cardIds = rows.results.map((r: any) => r.id as string);

  if (cardIds.length === 0) {
    c.header("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    return c.json({ data: [], total, hasMore: false });
  }

  // Batch-fetch related data for all cards in the page
  const ph = cardIds.map(() => "?").join(",");
  const [attacks, abilities, modifiers, types] = await Promise.all([
    db.prepare(`SELECT * FROM card_attacks WHERE card_id IN (${ph}) ORDER BY card_id, position`).bind(...cardIds).all(),
    db.prepare(`SELECT * FROM card_abilities WHERE card_id IN (${ph})`).bind(...cardIds).all(),
    db.prepare(`SELECT * FROM card_type_modifiers WHERE card_id IN (${ph})`).bind(...cardIds).all(),
    db.prepare(`SELECT * FROM card_types WHERE card_id IN (${ph})`).bind(...cardIds).all(),
  ]);

  const attacksByCard = groupBy(attacks.results as any[], "card_id");
  const abilitiesByCard = groupBy(abilities.results as any[], "card_id");
  const modifiersByCard = groupBy(modifiers.results as any[], "card_id");
  const typesByCard = groupBy(types.results as any[], "card_id");

  const parsed = rows.results.map((card: any) =>
    assembleCard(
      card,
      attacksByCard.get(card.id) ?? [],
      abilitiesByCard.get(card.id) ?? [],
      modifiersByCard.get(card.id) ?? [],
      typesByCard.get(card.id) ?? [],
    ),
  );

  c.header("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  return c.json({
    data: parsed,
    total,
    hasMore: offset + rows.results.length < total,
  });
});

// ---------------------------------------------------------------------------
// GET /:id (detail)
// ---------------------------------------------------------------------------

cardsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;

  const [card, attacks, abilities, modifiers, types] = await Promise.all([
    db.prepare(
      `SELECT c.*, s.name as set_name, s.logo as set_logo, s.symbol as set_symbol,
              s.release_date as set_release_date
       FROM cards c
       LEFT JOIN sets s ON c.set_id = s.id
       WHERE c.id = ?`
    )
      .bind(id)
      .first(),
    db.prepare("SELECT * FROM card_attacks WHERE card_id = ? ORDER BY position").bind(id).all(),
    db.prepare("SELECT * FROM card_abilities WHERE card_id = ?").bind(id).all(),
    db.prepare("SELECT * FROM card_type_modifiers WHERE card_id = ?").bind(id).all(),
    db.prepare("SELECT * FROM card_types WHERE card_id = ?").bind(id).all(),
  ]);

  if (!card) {
    return c.json({ error: "Card not found" }, 404);
  }

  const parsed = assembleCard(
    { ...card, dex_ids: safeJsonParse(card.dex_ids as string | null, []) },
    attacks.results as any[],
    abilities.results as any[],
    modifiers.results as any[],
    types.results as any[],
  );

  c.header("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  return c.json({ data: parsed });
});

export { cardsRoute };
