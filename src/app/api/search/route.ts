import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { SearchResult } from "@/lib/types";

export const dynamic = "force-dynamic";

// Fuzzy search across periods, civilizations, and events using pg_trgm
// (word_similarity tolerates typos; ILIKE catches exact substrings).
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const pool = getPool();
  const HEADLINE =
    "'MaxWords=20, MinWords=10, StartSel=«, StopSel=», MaxFragments=1'";
  const { rows } = await pool.query(
    `(
      SELECT 'period' AS kind, slug, name, NULL::text AS sub, start_year, end_year, thumb_url, slug AS period_slug,
             GREATEST(word_similarity($1, name), similarity(name, $1)) AS score,
             'name' AS source
      FROM periods
      WHERE name ILIKE '%' || $1 || '%' OR word_similarity($1, name) > 0.32
      ORDER BY score DESC
      LIMIT 3
    ) UNION ALL (
      SELECT 'civilization', c.slug, c.name, c.description, c.start_year, c.end_year, c.thumb_url, p.slug,
             GREATEST(
               word_similarity($1, c.name),
               similarity(c.name, $1),
               word_similarity($1, coalesce(c.description, '')) * 0.55
             ) AS score,
             'name' AS source
      FROM civilizations c JOIN periods p ON p.id = c.period_id
      WHERE c.name ILIKE '%' || $1 || '%'
         OR word_similarity($1, c.name) > 0.32
         OR word_similarity($1, coalesce(c.description, '')) > 0.5
      ORDER BY score DESC
      LIMIT 5
    ) UNION ALL (
      SELECT 'event', e.slug, e.name, e.description, e.year, e.end_year, e.thumb_url, p.slug,
             GREATEST(
               word_similarity($1, e.name),
               similarity(e.name, $1),
               word_similarity($1, coalesce(e.description, '')) * 0.55
             ) AS score,
             'name' AS source
      FROM events e JOIN periods p ON p.id = e.period_id
      WHERE e.name ILIKE '%' || $1 || '%'
         OR word_similarity($1, e.name) > 0.32
         OR word_similarity($1, coalesce(e.description, '')) > 0.5
      ORDER BY score DESC
      LIMIT 9
    ) UNION ALL (
      -- deep search: the full article texts hanging in the halls
      SELECT 'event' AS kind, t.slug, t.name,
             ts_headline('english', t.body, websearch_to_tsquery('english', $1), ${HEADLINE}) AS sub,
             t.start_year, t.end_year, t.thumb_url, t.period_slug, t.score,
             'text' AS source
      FROM (
        SELECT e.slug, e.name, c.body, e.year AS start_year, e.end_year, e.thumb_url, p.slug AS period_slug,
               ts_rank_cd(c.ts, websearch_to_tsquery('english', $1)) AS score
        FROM chapters c
        JOIN events e ON e.id = c.event_id
        JOIN periods p ON p.id = e.period_id
        WHERE c.ts @@ websearch_to_tsquery('english', $1)
        ORDER BY score DESC
        LIMIT 14
      ) t
    ) UNION ALL (
      SELECT 'civilization' AS kind, t.slug, t.name,
             ts_headline('english', t.body, websearch_to_tsquery('english', $1), ${HEADLINE}) AS sub,
             t.start_year, t.end_year, t.thumb_url, t.period_slug, t.score,
             'text' AS source
      FROM (
        SELECT cv.slug, cv.name, c.body, cv.start_year, cv.end_year, cv.thumb_url, p.slug AS period_slug,
               ts_rank_cd(c.ts, websearch_to_tsquery('english', $1)) AS score
        FROM chapters c
        JOIN civilizations cv ON cv.id = c.civilization_id
        JOIN periods p ON p.id = cv.period_id
        WHERE c.ts @@ websearch_to_tsquery('english', $1)
        ORDER BY score DESC
        LIMIT 8
      ) t
    )`,
    [q]
  );

  const named = rows.filter((r) => r.source === "name");
  const seen = new Set(named.map((r) => `${r.kind}:${r.slug}`));
  const deep: typeof rows = [];
  for (const r of rows
    .filter((x) => x.source === "text")
    .sort((a, b) => b.score - a.score)) {
    const key = `${r.kind}:${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deep.push(r);
    if (deep.length >= 6) break;
  }

  const results: SearchResult[] = [...named, ...deep].map((r) => ({
    kind: r.kind,
    slug: r.slug,
    name: r.name,
    sub: r.sub,
    startYear: r.start_year,
    endYear: r.end_year,
    thumbUrl: r.thumb_url,
    periodSlug: r.period_slug,
    source: r.source,
  }));
  return NextResponse.json({ results });
}
