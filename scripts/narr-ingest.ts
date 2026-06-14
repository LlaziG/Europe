// Read the agents' narration output files and write them into the DB.
// Idempotent: re-running only fills rows and skips malformed entries.
// Run: pnpm tsx scripts/narr-ingest.ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "/tmp/narr";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as {
    manifest: { idx: number; kind: "art" | "chapter" }[];
  };
  const kindByIdx = new Map(manifest.manifest.map((m) => [m.idx, m.kind]));

  let art = 0;
  let ch = 0;
  let bad = 0;
  for (const f of readdirSync(`${DIR}/out`)) {
    const m = f.match(/^(\d+)\.json$/);
    if (!m) continue;
    const idx = Number(m[1]);
    const kind = kindByIdx.get(idx);
    if (!kind) continue;
    let parsed: { items?: { id: number; narration: string }[] };
    try {
      parsed = JSON.parse(readFileSync(`${DIR}/out/${f}`, "utf8"));
    } catch {
      bad++;
      continue;
    }
    const table = kind === "art" ? "artworks" : "chapters";
    for (const it of parsed.items ?? []) {
      const text = (it.narration ?? "").trim();
      if (!it.id || text.length < 10) {
        bad++;
        continue;
      }
      await pool.query(
        `UPDATE ${table} SET narration = $1, storied = TRUE WHERE id = $2`,
        [text, it.id]
      );
      if (kind === "art") art++;
      else ch++;
    }
  }

  const left = await pool.query(
    `SELECT (SELECT count(*) FROM artworks WHERE NOT storied AND story IS NOT NULL AND length(story) > 12) AS art_unstoried,
            (SELECT count(*) FROM chapters WHERE NOT storied AND length(body) > 60) AS ch_unstoried`
  );
  console.log(
    JSON.stringify({ ingested_art: art, ingested_chapters: ch, skipped: bad, remaining: left.rows[0] })
  );
  await pool.end();
}

main();
