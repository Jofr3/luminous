import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getPlatformProxy } from "wrangler";
import type { Card } from "./tcgdex-types";
import { cardInsert } from "./shared";

const API_BASE = "https://api.tcgdex.net/v2/en";
const BACKEND_DIR = resolve(dirname(import.meta.path), "..");
const DB_NAME = "luminous-db";
const OUTPUT_PATH = resolve(BACKEND_DIR, "data/seed-card.sql");

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
