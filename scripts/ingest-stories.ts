// Ingest narrated chapters: each entity's full Wikipedia article as plain
// text, split into its real sections. Run: pnpm ingest:stories
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { CIVILIZATIONS, EVENTS } from "./seed-data";

const UA = "EuropaMuseum/1.0 (educational project; lazargeorgiev@airia.com)";
const SKIP =
  /^(references|see also|external links|bibliography|notes|further reading|sources|citations|gallery|footnotes|works cited|primary sources|secondary sources|explanatory notes)$/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchChapters(
  title: string
): Promise<{ title: string; body: string }[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1` +
    `&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(title)}`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (!res.ok) {
        await sleep(700 * (i + 1));
        continue;
      }
      await sleep(120);
      const json = (await res.json()) as {
        query?: { pages?: { extract?: string }[] };
      };
      const text = json?.query?.pages?.[0]?.extract ?? "";
      const parts = text.split(/^==\s*([^=].*?)\s*==\s*$/m); // lead, t1, b1, …
      const out: { title: string; body: string }[] = [];
      for (let p = 1; p + 1 < parts.length + 1; p += 2) {
        const t = (parts[p] ?? "").trim();
        if (!t || SKIP.test(t)) continue;
        const body = (parts[p + 1] ?? "")
          .replace(/^=+\s*(.*?)\s*=+\s*$/gm, "\n$1\n") // flatten subsections
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (body.length < 220) continue;
        out.push({ title: t.slice(0, 140), body: body.slice(0, 6000) });
        if (out.length >= 14) break;
      }
      return out;
    } catch {
      await sleep(700 * (i + 1));
    }
  }
  return [];
}

async function mapPool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    })
  );
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const jobs = [
    ...CIVILIZATIONS.map((c) => ({ kind: "civilization" as const, slug: c.slug, wiki: c.wiki })),
    ...EVENTS.map((e) => ({ kind: "event" as const, slug: e.slug, wiki: e.wiki })),
  ];
  let done = 0;
  await mapPool(jobs, 3, async (job) => {
    try {
      const chapters = await fetchChapters(job.wiki);
      const ownerCol = job.kind === "civilization" ? "civilization_id" : "event_id";
      const ownerTable = job.kind === "civilization" ? "civilizations" : "events";
      await pool.query(
        `DELETE FROM chapters WHERE ${ownerCol} = (SELECT id FROM ${ownerTable} WHERE slug = $1)`,
        [job.slug]
      );
      for (let i = 0; i < chapters.length; i++) {
        await pool.query(
          `INSERT INTO chapters (${ownerCol}, idx, title, body)
           VALUES ((SELECT id FROM ${ownerTable} WHERE slug = $1), $2, $3, $4)`,
          [job.slug, i, chapters[i].title, chapters[i].body]
        );
      }
      done++;
      if (done % 40 === 0) console.log(`${done}/${jobs.length}…`);
    } catch (e) {
      console.log(`ERR ${job.slug}: ${e}`);
    }
  });
  const stats = await pool.query(
    `SELECT count(*) AS chapters,
            count(DISTINCT civilization_id) AS civs,
            count(DISTINCT event_id) AS events
     FROM chapters`
  );
  console.log("chapters:", stats.rows[0]);
  await pool.end();
}

main();
