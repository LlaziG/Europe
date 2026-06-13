// Export every text still missing narration into single-type batch files for
// the agent fan-out. Resumable: only rows where narration IS NULL are dumped.
// Run: pnpm tsx scripts/narr-export.ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const DIR = "/tmp/narr";
const ART_PER = 60;
const CH_PER = 16;

type Item = { id: number; title: string; source: string };

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/in`, { recursive: true });
  mkdirSync(`${DIR}/out`, { recursive: true });

  const art = await pool.query(
    `SELECT id, title, story FROM artworks
     WHERE narration IS NULL AND story IS NOT NULL AND length(story) > 12
     ORDER BY id`
  );
  const ch = await pool.query(
    `SELECT id, title, body FROM chapters
     WHERE narration IS NULL AND length(body) > 60 ORDER BY id`
  );

  const artItems: Item[] = art.rows.map((r) => ({
    id: r.id,
    title: r.title,
    source: r.story,
  }));
  const chItems: Item[] = ch.rows.map((r) => ({
    id: r.id,
    title: r.title,
    source: String(r.body).slice(0, 2800),
  }));

  const manifest: { idx: number; kind: "art" | "chapter"; n: number }[] = [];
  let idx = 0;
  for (const batch of chunk(artItems, ART_PER)) {
    writeFileSync(`${DIR}/in/${idx}.json`, JSON.stringify({ kind: "art", items: batch }));
    manifest.push({ idx, kind: "art", n: batch.length });
    idx++;
  }
  for (const batch of chunk(chItems, CH_PER)) {
    writeFileSync(`${DIR}/in/${idx}.json`, JSON.stringify({ kind: "chapter", items: batch }));
    manifest.push({ idx, kind: "chapter", n: batch.length });
    idx++;
  }
  writeFileSync(`${DIR}/manifest.json`, JSON.stringify({ count: idx, manifest }));

  console.log(
    JSON.stringify({
      artworks: artItems.length,
      chapters: chItems.length,
      batches: idx,
      dir: DIR,
    })
  );
  await pool.end();
}

main();
