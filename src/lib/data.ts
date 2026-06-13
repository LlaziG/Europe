import { getPool } from "./db";
import type {
  Civilization,
  HistoricalEvent,
  Period,
  TimelinePayload,
} from "./types";

export async function getTimelinePayload(): Promise<TimelinePayload> {
  const pool = getPool();
  const [p, c, e] = await Promise.all([
    pool.query(`SELECT * FROM periods ORDER BY sort`),
    pool.query(
      `SELECT c.*, p.slug AS period_slug,
         (SELECT count(DISTINCT a.commons_file) FROM artworks a
            LEFT JOIN events e2 ON e2.id = a.event_id
            WHERE a.civilization_id = c.id OR e2.civilization_id = c.id)::int AS art_count
       FROM civilizations c JOIN periods p ON p.id = c.period_id
       ORDER BY c.start_year`
    ),
    pool.query(
      `SELECT e.*, p.slug AS period_slug, c.slug AS civ_slug,
         (SELECT count(*) FROM artworks a WHERE a.event_id = e.id)::int AS art_count
       FROM events e
       JOIN periods p ON p.id = e.period_id
       LEFT JOIN civilizations c ON c.id = e.civilization_id
       ORDER BY e.year`
    ),
  ]);

  const periods: Period[] = p.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    startYear: r.start_year,
    endYear: r.end_year,
    summary: r.summary,
    description: r.description,
    imageUrl: r.image_url,
    thumbUrl: r.thumb_url,
    imageW: r.image_w,
    imageH: r.image_h,
    wikiUrl: r.wiki_url,
    color: r.color,
    sort: r.sort,
  }));

  const civilizations: Civilization[] = c.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    periodSlug: r.period_slug,
    startYear: r.start_year,
    endYear: r.end_year,
    displayStart: r.display_start,
    displayEnd: r.display_end,
    summary: r.summary,
    description: r.description,
    imageUrl: r.image_url,
    thumbUrl: r.thumb_url,
    imageW: r.image_w,
    imageH: r.image_h,
    wikiUrl: r.wiki_url,
    artCount: r.art_count ?? 0,
  }));

  const events: HistoricalEvent[] = e.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    periodSlug: r.period_slug,
    civSlug: r.civ_slug,
    year: r.year,
    endYear: r.end_year,
    summary: r.summary,
    description: r.description,
    imageUrl: r.image_url,
    thumbUrl: r.thumb_url,
    imageW: r.image_w,
    imageH: r.image_h,
    wikiUrl: r.wiki_url,
    artCount: r.art_count ?? 0,
    onTimeline: r.on_timeline,
  }));

  return { periods, civilizations, events };
}
