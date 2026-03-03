import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { Card } from "./tcgdex-types";

const API_BASE = "https://api.tcgdex.net/v2/en";
const BACKEND_DIR = resolve(dirname(import.meta.path), "..");
const DB_NAME = "luminous-db";
const OUTPUT_PATH = resolve(BACKEND_DIR, "data/seed-card.sql");

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
  const cardId = process.argv[2];
  if (!cardId) {
    console.error("Usage: bun run scripts/seed-card.ts <card-id>");
    process.exit(1);
  }

  console.log(`Fetching card ${cardId} from TCGdex...`);
  const res = await fetch(`${API_BASE}/cards/${cardId}`);
  if (!res.ok) {
    console.error(`Card not found: HTTP ${res.status}`);
    process.exit(1);
  }
  const card: Card = await res.json();
  console.log(`Found: ${card.name} (${card.category})`);

  // Upload image to R2
  if (card.image) {
    console.log("Uploading image to R2...");
    const proxy = await getPlatformProxy<{ IMAGES: R2Bucket }>({
      configPath: resolve(BACKEND_DIR, "wrangler.jsonc"),
    });
    const r2 = proxy.env.IMAGES;
    const r2Key = `cards/${card.id}/high.webp`;

    const imgRes = await fetch(`${card.image}/high.webp`);
    if (imgRes.ok) {
      const data = await imgRes.arrayBuffer();
      await r2.put(r2Key, data, {
        httpMetadata: { contentType: "image/webp" },
      });
      console.log(`Image uploaded: ${r2Key} (${data.byteLength} bytes)`);
    } else {
      console.warn(`Image not available: HTTP ${imgRes.status}`);
    }

    await proxy.dispose();
  } else {
    console.log("No image available for this card.");
  }

  // Write and apply SQL
  const sql = cardInsert(card);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, sql + "\n");

  console.log("Applying to local D1...");
  const proc = Bun.spawn(
    ["bunx", "wrangler", "d1", "execute", DB_NAME, "--local", "--file", OUTPUT_PATH],
    { cwd: BACKEND_DIR, stdout: "inherit", stderr: "inherit" },
  );
  await proc.exited;

  if (proc.exitCode !== 0) {
    console.error("Failed to apply SQL");
    process.exit(1);
  }

  console.log(`Card ${card.id} seeded successfully!`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
