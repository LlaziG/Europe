// Pre-render a museum's narration to MP3 with ElevenLabs and store the files
// under public/narration/, so the gallery plays recordings instead of the
// browser voice. Voices the already-stored grounded narration — nothing new.
//
//   ELEVENLABS_API_KEY=... pnpm tsx scripts/tts-render.ts event fall-of-acre
//   (voice override: TTS_VOICE=<id>;  default below)
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.TTS_VOICE || "jbEI5QkrMSKWeDlP27MV";
const MODEL = process.env.TTS_MODEL || "eleven_multilingual_v2";
const PUB = "public/narration";
const FORCE = process.env.TTS_FORCE === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tts(text: string, outPath: string): Promise<number> {
  if (existsSync(outPath) && !FORCE) return 0; // idempotent
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return 0;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY as string, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: clean,
        model_id: MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
      }),
    }
  );
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  await sleep(250);
  return 1;
}

async function main() {
  if (!KEY) {
    console.error("ELEVENLABS_API_KEY is not set (add it to .env.local).");
    process.exit(1);
  }
  const type = process.argv[2];
  const slug = process.argv[3];
  if ((type !== "event" && type !== "civilization") || !slug) {
    console.error("usage: tts-render.ts <event|civilization> <slug>");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  mkdirSync(`${PUB}/art`, { recursive: true });
  mkdirSync(`${PUB}/welcome`, { recursive: true });

  const table = type === "event" ? "events" : "civilizations";
  const ent = await pool.query(`SELECT id, name FROM ${table} WHERE slug = $1`, [slug]);
  if (!ent.rows.length) {
    console.error("entity not found");
    process.exit(1);
  }
  const { id: entId, name } = ent.rows[0];

  // 1) welcome — matches what the gallery would otherwise speak
  let rendered = 0;
  rendered += await tts(`Welcome to ${name}.`, `${PUB}/welcome/${type}-${slug}.mp3`);
  console.log(`welcome: ${name}`);

  // 2) every speakable artwork in this museum
  const col = type === "event" ? "event_id" : "civilization_id";
  const art =
    type === "event"
      ? await pool.query(
          `SELECT id, title, COALESCE(narration, story) AS text FROM artworks
           WHERE event_id = $1 AND COALESCE(narration, story) IS NOT NULL ORDER BY id`,
          [entId]
        )
      : await pool.query(
          `SELECT DISTINCT ON (a.commons_file) a.id, a.title, COALESCE(a.narration, a.story) AS text
           FROM artworks a LEFT JOIN events e ON e.id = a.event_id
           WHERE (a.civilization_id = $1 OR e.civilization_id = $1)
             AND COALESCE(a.narration, a.story) IS NOT NULL
           ORDER BY a.commons_file, a.id`,
          [entId]
        );
  void col;

  for (const r of art.rows) {
    try {
      const n = await tts(r.text, `${PUB}/art/${r.id}.mp3`);
      rendered += n;
      console.log(`${n ? "rendered" : "cached "} art#${r.id} — ${r.title.slice(0, 50)}`);
    } catch (e) {
      console.log(`ERR art#${r.id}: ${e}`);
    }
  }

  console.log(`\ndone — ${rendered} new clips for ${type}/${slug} (voice ${VOICE})`);
  await pool.end();
}

main();
