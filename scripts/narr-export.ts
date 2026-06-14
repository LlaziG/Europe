// Export texts for the storytelling fan-out. Each item carries its subject and
// the surrounding historical context so the agent can tell a real chronological
// story, not just describe the object. Resumable by default (only rows missing
// narration); set NARR_REGEN=1 to re-do everything with the storytelling prompt.
// Run: pnpm tsx scripts/narr-export.ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const DIR = "/tmp/narr";
const ART_PER = 50;
const CH_PER = 14;
const REGEN = process.env.NARR_REGEN === "1";

type Item = {
  id: number;
  title: string;
  source: string;
  subject: string; // the civilization or event this piece belongs to
  context: string; // that subject's summary — the historical backbone
};

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(`${DIR}/in`, { recursive: true });
  mkdirSync(`${DIR}/out`, { recursive: true });

  // REGEN now means "everything that doesn't yet have storytelling narration"
  const where = REGEN ? "AND NOT a.storied" : "AND a.narration IS NULL";
  const art = await pool.query(
    `SELECT a.id, a.title, a.story,
            COALESCE(c.name, e.name) AS subject,
            COALESCE(c.summary, e.summary, '') AS context
     FROM artworks a
     LEFT JOIN civilizations c ON c.id = a.civilization_id
     LEFT JOIN events e ON e.id = a.event_id
     WHERE a.story IS NOT NULL AND length(a.story) > 12 ${where}
     ORDER BY a.id`
  );
  const chWhere = REGEN ? "AND NOT ch.storied" : "AND ch.narration IS NULL";
  const ch = await pool.query(
    `SELECT ch.id, ch.title, ch.body,
            COALESCE(c.name, e.name) AS subject,
            COALESCE(c.summary, e.summary, '') AS context
     FROM chapters ch
     LEFT JOIN civilizations c ON c.id = ch.civilization_id
     LEFT JOIN events e ON e.id = ch.event_id
     WHERE length(ch.body) > 60 ${chWhere}
     ORDER BY ch.id`
  );

  const artItems: Item[] = art.rows.map((r) => ({
    id: r.id,
    title: r.title,
    source: r.story,
    subject: r.subject ?? "",
    context: String(r.context).slice(0, 900),
  }));
  const chItems: Item[] = ch.rows.map((r) => ({
    id: r.id,
    title: r.title,
    source: String(r.body).slice(0, 3000),
    subject: r.subject ?? "",
    context: String(r.context).slice(0, 600),
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
    JSON.stringify({ regen: REGEN, artworks: artItems.length, chapters: chItems.length, batches: idx, dir: DIR })
  );
  await pool.end();
}

main();
