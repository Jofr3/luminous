import { parseDamage } from "@luminous/engine";
import type { Card } from "./tcgdex-types";

export function esc(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

export function cardInserts(c: Card): string[] {
  const stmts: string[] = [];

  // Main card INSERT (without the old JSON columns, keeping dex_ids)
  const vals = [
    esc(c.id),
    esc(c.localId),
    esc(c.name),
    c.image ? esc(`cards/${c.id}/high.webp`) : "NULL",
    esc(c.category),
    esc(c.illustrator),
    esc(c.rarity),
    c.hp != null ? String(c.hp) : "NULL",
    esc(c.stage),
    esc(c.evolveFrom),
    esc(c.description),
    esc(c.level),
    esc(c.suffix),
    esc(c.effect),
    esc(c.trainerType),
    esc(c.energyType),
    c.retreat != null ? String(c.retreat) : "NULL",
    esc(c.regulationMark),
    esc(c.legal.standard),
    esc(c.legal.expanded),
    esc(c.set.id),
    esc(c.updated),
    esc(c.variants?.normal),
    esc(c.variants?.reverse),
    esc(c.variants?.holo),
    esc(c.variants?.firstEdition),
    esc(c.variants?.wPromo),
    c.dexId ? esc(JSON.stringify(c.dexId)) : "NULL",
  ];
  stmts.push(
    `INSERT OR REPLACE INTO cards (id, local_id, name, image, category, illustrator, rarity, hp, stage, evolve_from, description, level, suffix, effect, trainer_type, energy_type, retreat, regulation_mark, legal_standard, legal_expanded, set_id, updated, variant_normal, variant_reverse, variant_holo, variant_first_edition, variant_w_promo, dex_ids) VALUES (${vals.join(", ")});`,
  );

  // Clear existing related rows (idempotent re-seed)
  stmts.push(`DELETE FROM card_attacks WHERE card_id = ${esc(c.id)};`);
  stmts.push(`DELETE FROM card_abilities WHERE card_id = ${esc(c.id)};`);
  stmts.push(`DELETE FROM card_type_modifiers WHERE card_id = ${esc(c.id)};`);
  stmts.push(`DELETE FROM card_types WHERE card_id = ${esc(c.id)};`);

  // Attacks
  if (c.attacks) {
    for (let i = 0; i < c.attacks.length; i++) {
      const a = c.attacks[i]!;
      const dmg = parseDamage(a.damage);
      stmts.push(
        `INSERT INTO card_attacks (card_id, position, name, cost, damage_base, damage_mod, damage_raw, effect) VALUES (${esc(c.id)}, ${i}, ${esc(a.name)}, ${esc(JSON.stringify(a.cost))}, ${dmg.base}, ${dmg.mod ? esc(dmg.mod) : "NULL"}, ${esc(dmg.raw)}, ${esc(a.effect)});`,
      );
    }
  }

  // Abilities
  if (c.abilities) {
    for (let i = 0; i < c.abilities.length; i++) {
      const ab = c.abilities[i]!;
      stmts.push(
        `INSERT INTO card_abilities (card_id, position, type, name, effect) VALUES (${esc(c.id)}, ${i}, ${esc(ab.type)}, ${esc(ab.name)}, ${esc(ab.effect)});`,
      );
    }
  }

  // Weaknesses
  if (c.weaknesses) {
    for (const w of c.weaknesses) {
      stmts.push(
        `INSERT INTO card_type_modifiers (card_id, kind, type, value) VALUES (${esc(c.id)}, 'weakness', ${esc(w.type)}, ${esc(w.value)});`,
      );
    }
  }

  // Resistances
  if (c.resistances) {
    for (const r of c.resistances) {
      stmts.push(
        `INSERT INTO card_type_modifiers (card_id, kind, type, value) VALUES (${esc(c.id)}, 'resistance', ${esc(r.type)}, ${esc(r.value)});`,
      );
    }
  }

  // Types
  if (c.types) {
    for (const t of c.types) {
      stmts.push(
        `INSERT INTO card_types (card_id, type) VALUES (${esc(c.id)}, ${esc(t)});`,
      );
    }
  }

  return stmts;
}

export async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
