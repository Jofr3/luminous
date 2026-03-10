import type { Card } from "./tcgdex-types";

export function esc(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

export function cardInsert(c: Card): string {
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
    c.attacks ? esc(JSON.stringify(c.attacks)) : "NULL",
    c.weaknesses ? esc(JSON.stringify(c.weaknesses)) : "NULL",
    c.resistances ? esc(JSON.stringify(c.resistances)) : "NULL",
    c.types ? esc(JSON.stringify(c.types)) : "NULL",
    c.dexId ? esc(JSON.stringify(c.dexId)) : "NULL",
  ];
  return `INSERT OR REPLACE INTO cards (id, local_id, name, image, category, illustrator, rarity, hp, stage, evolve_from, description, level, suffix, effect, trainer_type, energy_type, retreat, regulation_mark, legal_standard, legal_expanded, set_id, updated, variant_normal, variant_reverse, variant_holo, variant_first_edition, variant_w_promo, attacks, weaknesses, resistances, types, dex_ids) VALUES (${vals.join(", ")});`;
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
