// Ingest museum exhibits: every image embedded in an entity's Wikipedia
// article (editor-curated relevance), with metadata from Wikimedia Commons.
// Only freely-licensed files are kept (public domain / CC0 / CC BY / CC BY-SA);
// non-free "fair use" files never make it in. Run: pnpm ingest:art
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";
import { CIVILIZATIONS, EVENTS } from "./seed-data";

const UA = "EuropaMuseum/1.0 (educational project; lazargeorgiev@airia.com)";
const CIV_MAX = 14;
const EVENT_MAX = 10;

const EXCLUDE =
  /\b(map|maps|locator|location|flag|coat[_ ]of[_ ]arms|escudo|stemma|logo|icon|seal|banner|chart|graph|diagram|montage|collage|blank|globe|wappen|karte|disambig|pictogram|footprint)\b/i;
const LICENSE_OK = /public domain|^pd\b|pd-|cc0|cc[ -]by/i;
const PAINTING_HINT =
  /painting|portrait|fresco|canvas|tapestry|miniature|engraving|etching|drawing|illustration|lithograph|watercolou?r|oil on/i;

type MediaItem = {
  title: string;
  type: string;
  leadImage?: boolean;
  caption?: { text?: string };
};

type FileMeta = {
  title: string;
  url: string;
  descUrl: string;
  thumb: string | null;
  width: number;
  height: number;
  artist: string | null;
  date: string | null;
  description: string | null;
  license: string | null;
  credit: string | null;
};

const strip = (html: string | undefined | null) =>
  (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, tries = 3): Promise<unknown | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        await sleep(700 * (i + 1));
        continue;
      }
      await sleep(120);
      return await res.json();
    } catch {
      await sleep(700 * (i + 1));
    }
  }
  return null;
}

async function mediaList(title: string): Promise<MediaItem[]> {
  const json = (await getJson(
    `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}`
  )) as { items?: MediaItem[] } | null;
  return (json?.items ?? []).filter(
    (it) =>
      it.type === "image" &&
      !EXCLUDE.test(it.title) &&
      !/\.(svg|gif|webm|ogv|pdf|djvu)$/i.test(it.title)
  );
}

async function fileMetas(titles: string[]): Promise<Map<string, FileMeta>> {
  const out = new Map<string, FileMeta>();
  for (let i = 0; i < titles.length; i += 40) {
    const chunk = titles.slice(i, i + 40);
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2` +
      `&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=960&iiextmetadatafilter=` +
      encodeURIComponent("ImageDescription|Artist|DateTimeOriginal|LicenseShortName|Credit") +
      `&titles=` +
      encodeURIComponent(chunk.join("|"));
    const json = (await getJson(url)) as {
      query?: {
        pages?: {
          title: string;
          missing?: boolean;
          imageinfo?: {
            url: string;
            descriptionurl: string;
            thumburl?: string;
            width: number;
            height: number;
            mime: string;
            extmetadata?: Record<string, { value?: string }>;
          }[];
        }[];
      };
    } | null;
    for (const page of json?.query?.pages ?? []) {
      if (page.missing || !page.imageinfo?.length) continue;
      const ii = page.imageinfo[0];
      const ext = ii.extmetadata ?? {};
      out.set(page.title, {
        title: page.title,
        url: ii.url,
        descUrl: ii.descriptionurl,
        thumb: ii.thumburl ?? null,
        width: ii.width,
        height: ii.height,
        artist: strip(ext.Artist?.value) || null,
        date: strip(ext.DateTimeOriginal?.value) || null,
        description: strip(ext.ImageDescription?.value) || null,
        license: strip(ext.LicenseShortName?.value) || null,
        credit: strip(ext.Credit?.value) || null,
      });
    }
  }
  return out;
}

function parseYear(...candidates: (string | null)[]): number | null {
  for (const c of candidates) {
    if (!c) continue;
    const m = c.match(/\b(1[0-9]{3}|20[0-2][0-9]|[1-9][0-9]{2})\b/);
    if (m) return Number(m[1]);
    const cent = c.match(/\b(\d{1,2})(?:st|nd|rd|th)[- ]century\b/i);
    if (cent) return (Number(cent[1]) - 1) * 100 + 50;
  }
  return null;
}

async function ingestOwner(
  pool: Pool,
  ownerKind: "civilization" | "event",
  ownerSlug: string,
  wikiTitle: string,
  max: number
): Promise<number> {
  const items = await mediaList(wikiTitle);
  if (!items.length) return 0;
  const metas = await fileMetas(items.map((it) => it.title));
  let kept = 0;
  for (const item of items) {
    if (kept >= max) break;
    // the media-list uses underscores; the metadata API normalizes to spaces
    const meta = metas.get(item.title.replace(/_/g, " "));
    if (!meta) continue; // not on Commons → almost always non-free
    if (meta.width < 480 || meta.height < 360) continue;
    if (!meta.license || !LICENSE_OK.test(meta.license)) continue;
    if (meta.description && EXCLUDE.test(meta.description)) continue;

    const caption = strip(item.caption?.text);
    const story = [caption, meta.description]
      .filter((s, i, arr) => s && arr.indexOf(s) === i)
      .join(" — ")
      .slice(0, 900);
    const fileName = item.title.replace(/^File:/, "");
    const niceTitle =
      caption && caption.length > 6 && caption.length < 140
        ? caption
        : fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
    const slug = `${ownerSlug}--${fileName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 80)}`;
    const kind = PAINTING_HINT.test(`${fileName} ${meta.description ?? ""}`)
      ? "painting"
      : "artifact";

    await pool.query(
      `INSERT INTO artworks (slug, civilization_id, event_id, title, artist, year_label, year, kind,
         commons_file, image_url, thumb_url, width, height, story, facts, license, credit, wiki_url)
       VALUES ($1,
         ${ownerKind === "civilization" ? "(SELECT id FROM civilizations WHERE slug=$2)" : "NULL"},
         ${ownerKind === "event" ? "(SELECT id FROM events WHERE slug=$2)" : "NULL"},
         $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (slug) DO UPDATE SET title=$3, artist=$4, year_label=$5, year=$6, kind=$7,
         commons_file=$8, image_url=$9, thumb_url=$10, width=$11, height=$12,
         story=$13, facts=$14, license=$15, credit=$16, wiki_url=$17`,
      [
        slug,
        ownerSlug,
        niceTitle.slice(0, 220),
        meta.artist?.slice(0, 220) ?? null,
        meta.date?.slice(0, 120) ?? null,
        parseYear(meta.date, caption, meta.description),
        kind,
        fileName,
        meta.url,
        meta.thumb,
        meta.width,
        meta.height,
        story || null,
        JSON.stringify({
          artist: meta.artist,
          date: meta.date,
          license: meta.license,
          credit: meta.credit?.slice(0, 300),
          source: meta.descUrl,
          dimensions: `${meta.width} × ${meta.height}`,
        }),
        meta.license,
        meta.credit?.slice(0, 300) ?? null,
        meta.descUrl,
      ]
    );
    kept++;
  }
  return kept;
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
  let done = 0;

  const civJobs = CIVILIZATIONS.map((c) => ({
    kind: "civilization" as const,
    slug: c.slug,
    wiki: c.wiki,
    max: CIV_MAX,
  }));
  const evJobs = EVENTS.map((e) => ({
    kind: "event" as const,
    slug: e.slug,
    wiki: e.wiki,
    max: EVENT_MAX,
  }));
  const jobs = [...civJobs, ...evJobs];

  await mapPool(jobs, 3, async (job) => {
    try {
      const n = await ingestOwner(pool, job.kind, job.slug, job.wiki, job.max);
      done++;
      if (done % 25 === 0) console.log(`${done}/${jobs.length} owners…  (${job.slug}: ${n})`);
    } catch (e) {
      console.log(`ERR ${job.slug}: ${e}`);
    }
  });

  const stats = await pool.query(`
    SELECT (SELECT count(*) FROM artworks) AS total,
           (SELECT count(*) FROM artworks WHERE civilization_id IS NOT NULL) AS civ_art,
           (SELECT count(*) FROM artworks WHERE event_id IS NOT NULL) AS event_art`);
  console.log("artworks:", stats.rows[0]);

  // civilizations whose museum (own art + linked events' art) is still thin
  const thin = await pool.query(`
    SELECT c.slug,
      (SELECT count(*) FROM artworks a WHERE a.civilization_id = c.id) +
      (SELECT count(*) FROM artworks a JOIN events e ON e.id = a.event_id WHERE e.civilization_id = c.id) AS pieces
    FROM civilizations c
    GROUP BY c.slug, c.id
    HAVING (SELECT count(*) FROM artworks a WHERE a.civilization_id = c.id) +
           (SELECT count(*) FROM artworks a JOIN events e ON e.id = a.event_id WHERE e.civilization_id = c.id) < 8
    ORDER BY pieces`);
  if (thin.rows.length) {
    console.log("\nThin civilization museums (<8 pieces incl. linked events):");
    for (const r of thin.rows) console.log(`  ${r.slug}: ${r.pieces}`);
  } else {
    console.log("All civilization museums have 8+ pieces.");
  }
  await pool.end();
}

main();
