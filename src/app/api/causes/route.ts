import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import type { CauseGraph, CauseNode, CauseEdge } from "@/lib/types";

export const dynamic = "force-dynamic";

// The documented ancestry of one event: a breadth-first walk back through the
// `causes` edges (cause precedes effect by construction), gathering every
// antecedent until the chains run dry or hit antiquity.
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim();
  if (!slug) return NextResponse.json({ error: "no slug" }, { status: 400 });

  const pool = getPool();
  const root = await pool.query(
    `SELECT e.id, e.slug, e.name, e.year, e.end_year, e.thumb_url, e.summary,
            p.slug AS period_slug, p.color
     FROM events e JOIN periods p ON p.id = e.period_id WHERE e.slug = $1`,
    [slug]
  );
  if (!root.rows.length)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const nodes = new Map<number, CauseNode>();
  const edges: CauseEdge[] = [];
  const add = (r: Record<string, unknown>) => {
    if (!nodes.has(r.id as number))
      nodes.set(r.id as number, {
        id: r.id as number,
        slug: r.slug as string,
        name: r.name as string,
        year: r.year as number,
        endYear: r.end_year as number | null,
        thumbUrl: r.thumb_url as string | null,
        periodSlug: r.period_slug as string,
        color: r.color as string,
      });
  };
  add(root.rows[0]);

  // Curated ancestry, not the whole database: follow only the strongest few
  // causes per node and cap total size, so the lineage stays legible while
  // still threading back toward antiquity via the best-attested links.
  const PER_NODE = 3;
  const MAX_NODES = 40;
  let frontier = [root.rows[0].id as number];
  const visited = new Set<number>(frontier);
  let depth = 0;
  while (frontier.length && depth < 12 && nodes.size < MAX_NODES) {
    const res = await pool.query(
      `SELECT * FROM (
         SELECT c.cause_event_id, c.effect_event_id, c.sentence, c.source_slug, c.score,
                e.id, e.slug, e.name, e.year, e.end_year, e.thumb_url, p.slug AS period_slug, p.color,
                row_number() OVER (PARTITION BY c.effect_event_id ORDER BY c.score DESC, e.year DESC) AS rn
         FROM causes c
         JOIN events e ON e.id = c.cause_event_id
         JOIN periods p ON p.id = e.period_id
         WHERE c.effect_event_id = ANY($1::int[])
       ) q WHERE q.rn <= $2
       ORDER BY q.score DESC`,
      [frontier, PER_NODE]
    );
    const next: number[] = [];
    for (const r of res.rows) {
      // edges to already-known nodes still draw; only cap NEW node expansion
      const isNew = !visited.has(r.cause_event_id);
      if (isNew && nodes.size >= MAX_NODES) continue;
      add(r);
      edges.push({
        from: r.cause_event_id,
        to: r.effect_event_id,
        sentence: r.sentence,
        sourceSlug: r.source_slug,
        score: r.score,
      });
      if (isNew) {
        visited.add(r.cause_event_id);
        next.push(r.cause_event_id);
      }
    }
    frontier = next;
    depth++;
  }

  // depth of each node from the root (how many causal steps back)
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    const arr = adj.get(e.to) ?? [];
    arr.push(e.from);
    adj.set(e.to, arr);
  }
  const rootId = root.rows[0].id as number;
  const dist = new Map<number, number>([[rootId, 0]]);
  let layer = [rootId];
  let d = 0;
  while (layer.length) {
    const nx: number[] = [];
    for (const id of layer)
      for (const c of adj.get(id) ?? [])
        if (!dist.has(c)) {
          dist.set(c, d + 1);
          nx.push(c);
        }
    layer = nx;
    d++;
  }
  for (const n of nodes.values()) n.depth = dist.get(n.id) ?? 99;

  const graph: CauseGraph = {
    rootId,
    nodes: [...nodes.values()].sort((a, b) => a.year - b.year),
    edges: edges.filter(
      (e, i, arr) =>
        arr.findIndex((x) => x.from === e.from && x.to === e.to) === i
    ),
  };
  return NextResponse.json(graph);
}
