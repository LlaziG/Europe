import { getPool } from "./db";
import { fmtSpan } from "@/components/timeline/timeline-utils";
import type { Artwork, Chapter, MuseumEntity } from "./types";

function mapArtwork(r: Record<string, unknown>): Artwork {
  return {
    id: r.id as number,
    slug: r.slug as string,
    title: r.title as string,
    artist: r.artist as string | null,
    yearLabel: r.year_label as string | null,
    year: r.year as number | null,
    kind: r.kind as string,
    imageUrl: r.image_url as string | null,
    thumbUrl: r.thumb_url as string | null,
    width: r.width as number | null,
    height: r.height as number | null,
    story: r.story as string | null,
    narration: r.narration as string | null,
    license: r.license as string | null,
    credit: r.credit as string | null,
    wikiUrl: r.wiki_url as string | null,
  };
}

export async function getMuseum(
  kind: "civilization" | "event",
  slug: string
): Promise<{
  entity: MuseumEntity;
  artworks: Artwork[];
  chapters: Chapter[];
} | null> {
  const pool = getPool();

  if (kind === "civilization") {
    const ent = await pool.query(
      `SELECT c.*, p.name AS period_name, p.color AS period_color
       FROM civilizations c JOIN periods p ON p.id = c.period_id
       WHERE c.slug = $1`,
      [slug]
    );
    if (!ent.rows.length) return null;
    const c = ent.rows[0];
    // a civilization's museum shows its own pieces plus those of its events
    const art = await pool.query(
      `SELECT DISTINCT ON (commons_file) a.*
       FROM artworks a
       LEFT JOIN events e ON e.id = a.event_id
       WHERE a.civilization_id = $1 OR e.civilization_id = $1
       ORDER BY commons_file, a.id`,
      [c.id]
    );
    const chapters = await pool.query(
      `SELECT id, idx, title, body, narration FROM chapters
       WHERE civilization_id = $1 ORDER BY idx`,
      [c.id]
    );
    const ordered = art.rows.sort((x, y) => x.id - y.id);
    return {
      entity: {
        kind,
        slug,
        name: c.name,
        datesLabel: fmtSpan(c.start_year, c.end_year),
        endYear: c.end_year,
        periodName: c.period_name,
        color: c.period_color,
        summary: c.summary,
        wikiUrl: c.wiki_url,
      },
      artworks: ordered.map(mapArtwork),
      chapters: chapters.rows as Chapter[],
    };
  }

  const ent = await pool.query(
    `SELECT e.*, p.name AS period_name, p.color AS period_color
     FROM events e JOIN periods p ON p.id = e.period_id
     WHERE e.slug = $1`,
    [slug]
  );
  if (!ent.rows.length) return null;
  const e = ent.rows[0];
  const art = await pool.query(
    `SELECT * FROM artworks WHERE event_id = $1 ORDER BY id`,
    [e.id]
  );
  const chapters = await pool.query(
    `SELECT id, idx, title, body, narration FROM chapters
     WHERE event_id = $1 ORDER BY idx`,
    [e.id]
  );
  return {
    entity: {
      kind,
      slug,
      name: e.name,
      datesLabel: fmtSpan(e.year, e.end_year),
      endYear: e.end_year ?? e.year,
      periodName: e.period_name,
      color: e.period_color,
      summary: e.summary,
      wikiUrl: e.wiki_url,
    },
    artworks: art.rows.map(mapArtwork),
    chapters: chapters.rows as Chapter[],
  };
}
