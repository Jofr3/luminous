import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getPlatformProxy } from "wrangler";
import { esc, pMap } from "./shared";

const CONCURRENCY = 10;
const DELAY_MS = 100;
const DB_NAME = "luminous-db";
const BACKEND_DIR = resolve(dirname(import.meta.path), "..");
const OUTPUT_PATH = resolve(BACKEND_DIR, "data/migrate-images.sql");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Get R2 binding via platform proxy
  const proxy = await getPlatformProxy<{ IMAGES: R2Bucket }>({
    configPath: resolve(BACKEND_DIR, "wrangler.jsonc"),
  });
  const r2 = proxy.env.IMAGES;

  // Query all cards with external image URLs
  console.log("Querying cards with external image URLs...");
  const proc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      DB_NAME,
      "--local",
      "--command",
      "SELECT id, image FROM cards WHERE image LIKE 'https://%'",
      "--json",
    ],
    { cwd: BACKEND_DIR, stdout: "pipe", stderr: "inherit" },
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    console.error("Failed to query cards");
    process.exit(1);
  }

  const parsed = JSON.parse(output);
  const cards: { id: string; image: string }[] = parsed[0]?.results ?? [];

  if (cards.length === 0) {
    console.log("No cards with external URLs found. Nothing to migrate.");
    await proxy.dispose();
    return;
  }

  console.log(`Found ${cards.length} cards to migrate.`);

  const sql: string[] = [];
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  await pMap(
    cards,
    async (card) => {
      const r2Key = `cards/${card.id}/high.webp`;

      // Check if already uploaded (idempotent)
      const existing = await r2.head(r2Key);
      if (existing) {
        console.log(`  [skip] ${card.id} — already in R2`);
        sql.push(
          `UPDATE cards SET image = ${esc(r2Key)} WHERE id = ${esc(card.id)};`,
        );
        skipped++;
        return;
      }

      // Download from TCGdex
      const imageUrl = `${card.image}/high.webp`;
      try {
        const res = await fetch(imageUrl);
        if (!res.ok) {
          console.error(
            `  [fail] ${card.id} — HTTP ${res.status} from ${imageUrl}`,
          );
          failed++;
          return;
        }

        const data = await res.arrayBuffer();
        await r2.put(r2Key, data, {
          httpMetadata: { contentType: "image/webp" },
        });

        sql.push(
          `UPDATE cards SET image = ${esc(r2Key)} WHERE id = ${esc(card.id)};`,
        );
        downloaded++;
        console.log(`  [done] ${card.id} (${data.byteLength} bytes)`);
      } catch (err) {
        console.error(`  [fail] ${card.id}:`, err);
        failed++;
      }

      // Small delay to be polite to TCGdex
      await Bun.sleep(DELAY_MS);
    },
    CONCURRENCY,
  );

  console.log(
    `\nMigration: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`,
  );

  if (sql.length === 0) {
    console.log("No SQL updates to apply.");
    await proxy.dispose();
    return;
  }

  // Write and apply SQL
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, sql.join("\n") + "\n");
  console.log(`SQL written to ${OUTPUT_PATH}`);

  console.log("Applying image URL updates to local D1...");
  const applyProc = Bun.spawn(
    [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      DB_NAME,
      "--local",
      "--file",
      OUTPUT_PATH,
    ],
    { cwd: BACKEND_DIR, stdout: "inherit", stderr: "inherit" },
  );
  await applyProc.exited;

  if (applyProc.exitCode !== 0) {
    console.error("Failed to apply SQL updates");
    await proxy.dispose();
    process.exit(1);
  }

  console.log("Image migration complete!");
  await proxy.dispose();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
