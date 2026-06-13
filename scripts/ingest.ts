// Ingest timeline data: fetch every period/civilization/event summary,
// portrait, and canonical URL from the Wikipedia REST API and upsert into
// Postgres. Run: pnpm ingest
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { PERIODS, CIVILIZATIONS, EVENTS } from "./seed-data";

const UA = "EuropaMuseum/1.0 (educational project; lazargeorgiev@airia.com)";

type WikiSummary = {
  type: string;
  title: string;
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string; width?: number; height?: number };
  content_urls?: { desktop?: { page?: string } };
};

const failures: string[] = [];

async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/ /g, "_")
  )}?redirect=true`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (res.status === 404) {
        failures.push(`404  ${title}`);
        return null;
      }
      if (!res.ok) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        failures.push(`${res.status}  ${title}`);
        return null;
      }
      const json = (await res.json()) as WikiSummary;
      if (json.type === "disambiguation") {
        failures.push(`DISAMBIG  ${title}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 150));
      return json;
    } catch (e) {
      if (attempt === 2) failures.push(`ERR  ${title}: ${e}`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]);
      }
    })
  );
  return results;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log(`Fetching ${PERIODS.length} periods…`);
  const periodSummaries = await mapPool(PERIODS, 3, (p) => fetchSummary(p.wiki));
  for (let i = 0; i < PERIODS.length; i++) {
    const p = PERIODS[i];
    const s = periodSummaries[i];
    await pool.query(
      `INSERT INTO periods (slug, name, start_year, end_year, wiki_title, wiki_url, summary, description, image_url, thumb_url, color, sort, image_w, image_h)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (slug) DO UPDATE SET name=$2, start_year=$3, end_year=$4, wiki_title=$5, wiki_url=$6,
         summary=COALESCE($7, periods.summary), description=COALESCE($8, periods.description),
         image_url=COALESCE($9, periods.image_url), thumb_url=COALESCE($10, periods.thumb_url), color=$11, sort=$12,
         image_w=COALESCE($13, periods.image_w), image_h=COALESCE($14, periods.image_h)`,
      [
        p.slug, p.name, p.start, p.end, p.wiki,
        s?.content_urls?.desktop?.page ?? null,
        s?.extract ?? null, s?.description ?? null,
        s?.originalimage?.source ?? null, s?.thumbnail?.source ?? null,
        p.color, i,
        s?.originalimage?.width ?? null, s?.originalimage?.height ?? null,
      ]
    );
  }

  console.log(`Fetching ${CIVILIZATIONS.length} civilizations…`);
  const civSummaries = await mapPool(CIVILIZATIONS, 3, (c) => fetchSummary(c.wiki));
  for (let i = 0; i < CIVILIZATIONS.length; i++) {
    const c = CIVILIZATIONS[i];
    const s = civSummaries[i];
    await pool.query(
      `INSERT INTO civilizations (slug, period_id, name, start_year, end_year, display_start, display_end, wiki_title, wiki_url, summary, description, image_url, thumb_url, image_w, image_h)
       VALUES ($1,(SELECT id FROM periods WHERE slug=$2),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (slug) DO UPDATE SET period_id=(SELECT id FROM periods WHERE slug=$2), name=$3, start_year=$4, end_year=$5,
         display_start=$6, display_end=$7, wiki_title=$8, wiki_url=$9,
         summary=COALESCE($10, civilizations.summary), description=COALESCE($11, civilizations.description),
         image_url=COALESCE($12, civilizations.image_url), thumb_url=COALESCE($13, civilizations.thumb_url),
         image_w=COALESCE($14, civilizations.image_w), image_h=COALESCE($15, civilizations.image_h)`,
      [
        c.slug, c.period, c.name, c.start, c.end,
        c.displayStart ?? null, c.displayEnd ?? null, c.wiki,
        s?.content_urls?.desktop?.page ?? null,
        s?.extract ?? null, s?.description ?? null,
        s?.originalimage?.source ?? null, s?.thumbnail?.source ?? null,
        s?.originalimage?.width ?? null, s?.originalimage?.height ?? null,
      ]
    );
  }

  console.log(`Fetching ${EVENTS.length} events…`);
  const eventSummaries = await mapPool(EVENTS, 3, (e) => fetchSummary(e.wiki));
  for (let i = 0; i < EVENTS.length; i++) {
    const e = EVENTS[i];
    const s = eventSummaries[i];
    await pool.query(
      `INSERT INTO events (slug, period_id, civilization_id, name, year, end_year, wiki_title, wiki_url, summary, description, image_url, thumb_url, image_w, image_h, on_timeline)
       VALUES ($1,(SELECT id FROM periods WHERE slug=$2),(SELECT id FROM civilizations WHERE slug=$3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (slug) DO UPDATE SET period_id=(SELECT id FROM periods WHERE slug=$2),
         civilization_id=(SELECT id FROM civilizations WHERE slug=$3), name=$4, year=$5, end_year=$6, wiki_title=$7, wiki_url=$8,
         summary=COALESCE($9, events.summary), description=COALESCE($10, events.description),
         image_url=COALESCE($11, events.image_url), thumb_url=COALESCE($12, events.thumb_url),
         image_w=COALESCE($13, events.image_w), image_h=COALESCE($14, events.image_h), on_timeline=$15`,
      [
        e.slug, e.period, e.civ ?? null, e.name, e.year, e.endYear ?? null, e.wiki,
        s?.content_urls?.desktop?.page ?? null,
        s?.extract ?? null, s?.description ?? null,
        s?.originalimage?.source ?? null, s?.thumbnail?.source ?? null,
        s?.originalimage?.width ?? null, s?.originalimage?.height ?? null,
        e.onTimeline ?? true,
      ]
    );
  }

  const counts = await pool.query(
    `SELECT (SELECT count(*) FROM periods) AS periods,
            (SELECT count(*) FROM civilizations) AS civs,
            (SELECT count(*) FROM events) AS events,
            (SELECT count(*) FROM civilizations WHERE summary IS NULL) AS civs_missing,
            (SELECT count(*) FROM events WHERE summary IS NULL) AS events_missing,
            (SELECT count(*) FROM civilizations WHERE thumb_url IS NULL) AS civs_noimg,
            (SELECT count(*) FROM events WHERE thumb_url IS NULL) AS events_noimg`
  );
  console.log("DB counts:", counts.rows[0]);
  await pool.end();

  if (failures.length) {
    console.log(`\n${failures.length} fetch failures:`);
    for (const f of failures) console.log("  " + f);
    process.exitCode = 1;
  } else {
    console.log("All titles fetched cleanly.");
  }
}

main();
