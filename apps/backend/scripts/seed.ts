import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { SerieBrief, Serie, Set, Card } from "./tcgdex-types";

const API_BASE = "https://api.tcgdex.net/v2/en";
const CONCURRENCY = 10;
const DELAY_BETWEEN_SETS_MS = 500;
const OUTPUT_PATH = resolve(dirname(import.meta.path), "../data/seed.sql");
const DB_NAME = "luminous-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "1" : "0";
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const url = `${API_BASE}${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  HTTP ${res.status} for ${url}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      console.error(`  Fetch error (attempt ${attempt + 1}) for ${url}:`, err);
      if (attempt < 2) await Bun.sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// R2 image upload (uses local R2 binding via getPlatformProxy)
// ---------------------------------------------------------------------------

let r2Bucket: R2Bucket | null = null;
let disposeProxy: (() => Promise<void>) | null = null;

async function getR2(): Promise<R2Bucket> {
  if (r2Bucket) return r2Bucket;
  const proxy = await getPlatformProxy<{ IMAGES: R2Bucket }>({
    configPath: resolve(dirname(import.meta.path), "../wrangler.jsonc"),
  });
  r2Bucket = proxy.env.IMAGES;
  disposeProxy = proxy.dispose;
  return r2Bucket;
}

async function uploadImageToR2(card: Card): Promise<void> {
  if (!card.image) return;

  const r2Key = `cards/${card.id}/high.webp`;
  const imageUrl = `${card.image}/high.webp`;

  try {
    const r2 = await getR2();

    // Check if already exists (idempotent)
    const existing = await r2.head(r2Key);
    if (existing) return;

    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.error(`      [img] HTTP ${res.status} for ${card.id}`);
      return;
    }

    const data = await res.arrayBuffer();
    await r2.put(r2Key, data, {
      httpMetadata: { contentType: "image/webp" },
    });
  } catch (err) {
    console.error(`      [img] Failed for ${card.id}:`, err);
  }
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

function seriesInsert(s: SerieBrief): string {
  return `INSERT OR REPLACE INTO series (id, name, logo) VALUES (${esc(s.id)}, ${esc(s.name)}, ${esc(s.logo)});`;
}

function setInsert(s: Set, seriesId: string): string {
  return `INSERT OR REPLACE INTO sets (id, name, logo, symbol, card_count_total, card_count_official, release_date, tcg_online_code, series_id, legal_standard, legal_expanded) VALUES (${esc(s.id)}, ${esc(s.name)}, ${esc(s.logo)}, ${esc(s.symbol)}, ${s.cardCount.total}, ${s.cardCount.official}, ${esc(s.releaseDate)}, ${esc(s.tcgOnline)}, ${esc(seriesId)}, ${esc(s.legal.standard)}, ${esc(s.legal.expanded)});`;
}

function cardInsert(c: Card): string {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching all series...");
  const seriesList = await fetchJson<SerieBrief[]>("/series");
  if (!seriesList) {
    console.error("Failed to fetch series list");
    process.exit(1);
  }
  console.log(`Found ${seriesList.length} series`);

  const sql: string[] = [];
  sql.push("-- Auto-generated seed data from TCGdex API");
  sql.push("-- Generated at " + new Date().toISOString());
  sql.push("");

  let totalCards = 0;
  let totalSets = 0;

  for (const serieBrief of seriesList) {
    console.log(`\nProcessing series: ${serieBrief.name} (${serieBrief.id})`);

    const serie = await fetchJson<Serie>(`/series/${serieBrief.id}`);
    if (!serie) {
      console.error(`  Failed to fetch series ${serieBrief.id}, skipping`);
      continue;
    }

    // Insert series
    sql.push(seriesInsert(serieBrief));

    // Process each set in this series
    for (const setBrief of serie.sets) {
      console.log(`  Set: ${setBrief.name} (${setBrief.id})`);

      const setDetail = await fetchJson<Set>(`/sets/${setBrief.id}`);
      if (!setDetail) {
        console.error(`    Failed to fetch set ${setBrief.id}, skipping`);
        continue;
      }

      // Insert set
      sql.push(setInsert(setDetail, serie.id));
      totalSets++;

      // Fetch all card details with concurrency limit
      const cardBriefs = setDetail.cards ?? [];
      console.log(`    Fetching ${cardBriefs.length} cards...`);

      const cards = await pMap(
        cardBriefs,
        async (brief) => {
          const card = await fetchJson<Card>(`/cards/${brief.id}`);
          if (card) await uploadImageToR2(card);
          return card;
        },
        CONCURRENCY
      );

      for (const card of cards) {
        if (card) {
          sql.push(cardInsert(card));
          totalCards++;
        }
      }

      console.log(`    Done (${cards.filter(Boolean).length} cards inserted)`);

      // Small delay between sets to be polite
      await Bun.sleep(DELAY_BETWEEN_SETS_MS);
    }
  }

  // Write SQL file
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, sql.join("\n") + "\n");
  console.log(`\nSeed file written to ${OUTPUT_PATH}`);
  console.log(`Total: ${seriesList.length} series, ${totalSets} sets, ${totalCards} cards`);

  // Execute via wrangler
  console.log("\nApplying seed data to local D1...");
  const proc = Bun.spawn(
    ["bunx", "wrangler", "d1", "execute", DB_NAME, "--local", "--file", OUTPUT_PATH],
    { cwd: resolve(dirname(import.meta.path), ".."), stdout: "inherit", stderr: "inherit" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("wrangler d1 execute failed with exit code", exitCode);
    process.exit(1);
  }
  console.log("Seed data applied successfully!");

  // Clean up miniflare proxy
  if (disposeProxy) await disposeProxy();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
