// Mine documented causal edges: event A (earlier) → event B (later) whenever
// either article mentions the other by name. The asserting sentence is stored
// with each edge. Pure cross-referencing of Wikipedia text — nothing invented.
// Run after chapters are ingested: pnpm ingest:causes
import { config } from "dotenv";
config({ path: ".env.local" });
import { Pool } from "pg";

const CAUSAL_CUE =
  /led to|cause|caused|resulted|result of|because|aftermath|consequence|response to|following|sparked|triggered|provoked|paved the way|gave rise|origins|precipitat|contributed to|in the wake of|legacy|escalat/i;
const CAUSAL_SECTION =
  /background|origins|causes|prelude|context|aftermath|legacy|consequences|impact|road to|buildup|lead-?up/i;

type Ev = {
  id: number;
  slug: string;
  name: string;
  wiki: string;
  year: number;
  names: string[];
};

type Chapter = { idx: number; title: string; body: string };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const evRes = await pool.query(
    `SELECT id, slug, name, wiki_title, year, summary FROM events`
  );
  const events: Ev[] = evRes.rows.map((r) => {
    const names = new Set<string>();
    for (const n of [r.name, r.name.replace(/^The /i, ""), r.wiki_title]) {
      if (n && n.length >= 5 && !/^\d+$/.test(n)) names.add(n);
    }
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      wiki: r.wiki_title,
      year: r.year,
      names: [...names],
    };
  });

  const chRes = await pool.query(
    `SELECT event_id, idx, title, body FROM chapters WHERE event_id IS NOT NULL`
  );
  const chaptersBy = new Map<number, Chapter[]>();
  for (const r of chRes.rows) {
    const arr = chaptersBy.get(r.event_id) ?? [];
    arr.push({ idx: r.idx, title: r.title, body: r.body });
    chaptersBy.set(r.event_id, arr);
  }
  const sumBy = new Map<number, string>(
    evRes.rows.map((r) => [r.id, r.summary ?? ""])
  );

  // precompute lowercase corpora
  const corpus = new Map<number, { lower: string; chapters: Chapter[] }>();
  for (const e of events) {
    const chs = chaptersBy.get(e.id) ?? [];
    const all =
      (sumBy.get(e.id) ?? "") + "\n" + chs.map((c) => c.body).join("\n");
    corpus.set(e.id, { lower: all.toLowerCase(), chapters: chs });
  }

  // find the sentence asserting the mention, with its score
  function findAssertion(
    holder: Ev,
    mentioned: Ev
  ): { sentence: string; score: number } | null {
    const c = corpus.get(holder.id);
    if (!c) return null;
    const hit = mentioned.names.find((n) =>
      c.lower.includes(n.toLowerCase())
    );
    if (!hit) return null;
    const re = new RegExp(`\\b${escapeRe(hit)}`, "i");

    let best: { sentence: string; score: number } | null = null;
    const consider = (text: string, bonus: number) => {
      if (!re.test(text)) return;
      for (const s of sentencesOf(text)) {
        if (!re.test(s)) continue;
        let score = 1 + bonus;
        if (CAUSAL_CUE.test(s)) score += 2;
        const cand = { sentence: s.trim().slice(0, 420), score };
        if (!best || cand.score > best.score) best = cand;
      }
    };
    consider(sumBy.get(holder.id) ?? "", 1);
    for (const ch of c.chapters) {
      const sectionBonus =
        (CAUSAL_SECTION.test(ch.title) ? 2 : 0) + (ch.idx <= 1 ? 1 : 0);
      consider(ch.body, sectionBonus);
    }
    return best;
  }

  type Edge = { cause: Ev; effect: Ev; sentence: string; source: string; score: number };
  const edges = new Map<string, Edge>();

  for (let i = 0; i < events.length; i++) {
    for (let j = 0; j < events.length; j++) {
      if (i === j) continue;
      const a = events[i]; // candidate cause
      const b = events[j]; // candidate effect
      if (a.year >= b.year) continue;

      // B's article reaches back to A (background), or A's reaches forward to B (aftermath)
      const inEffect = findAssertion(b, a);
      const inCause = findAssertion(a, b);
      const pick =
        inEffect && (!inCause || inEffect.score >= inCause.score)
          ? { ...inEffect, source: b.slug }
          : inCause
            ? { ...inCause, source: a.slug }
            : null;
      if (!pick) continue;

      const key = `${a.id}->${b.id}`;
      const prev = edges.get(key);
      if (!prev || pick.score > prev.score)
        edges.set(key, {
          cause: a,
          effect: b,
          sentence: pick.sentence,
          source: pick.source,
          score: pick.score,
        });
    }
    if (i % 60 === 0) console.log(`scanning… ${i}/${events.length}`);
  }

  // keep the strongest few causes per effect — webs, not megatrees
  const byEffect = new Map<number, Edge[]>();
  for (const e of edges.values()) {
    const arr = byEffect.get(e.effect.id) ?? [];
    arr.push(e);
    byEffect.set(e.effect.id, arr);
  }
  const kept: Edge[] = [];
  for (const arr of byEffect.values()) {
    arr.sort(
      (x, y) =>
        y.score - x.score ||
        y.cause.year - x.cause.year // prefer the nearer antecedent on ties
    );
    kept.push(...arr.slice(0, 6));
  }

  await pool.query(`TRUNCATE causes`);
  for (const e of kept) {
    await pool.query(
      `INSERT INTO causes (cause_event_id, effect_event_id, sentence, source_slug, score)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cause_event_id, effect_event_id) DO UPDATE SET sentence=$3, source_slug=$4, score=$5`,
      [e.cause.id, e.effect.id, e.sentence, e.source, e.score]
    );
  }

  console.log(`edges kept: ${kept.length} (from ${edges.size} candidates)`);
  const probe = await pool.query(`
    SELECT e2.name AS cause, e1.name AS effect, c.score
    FROM causes c
    JOIN events e1 ON e1.id = c.effect_event_id
    JOIN events e2 ON e2.id = c.cause_event_id
    WHERE e1.slug = 'migrant-crisis'
    ORDER BY c.score DESC`);
  console.log("migrant-crisis causes:", probe.rows);
  await pool.end();
}

main();
