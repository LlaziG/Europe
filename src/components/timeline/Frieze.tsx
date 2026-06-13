"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Civilization, HistoricalEvent, VariantProps } from "@/lib/types";
import {
  civSpan,
  clamp,
  fmtSpan,
  fmtYear,
  generateTicks,
  packLanes,
  thumbAt,
  uToYear,
  yearToU,
} from "./timeline-utils";
import { useZoom, type ZoomState } from "./useZoom";

const WORLD = 2400;
const X = (y: number) => yearToU(y) * WORLD;

// Participants of an event = its linked civilization plus any civilization
// whose name (adjective forms included) is mentioned in the event's own
// Wikipedia summary, gated to civilizations alive during the event's span.
const CIV_TOKENS: Record<string, string[]> = {
  minoans: ["Minoan"],
  "ancient-greece": ["Greek", "Greece", "Athen", "Sparta", "Macedon", "Hellen"],
  etruscans: ["Etruscan"],
  celts: ["Celt", "Gaul", "Gallic"],
  "ancient-rome": ["Rome", "Roman"],
  "byzantine-empire": ["Byzantine", "Byzantium"],
  francia: ["Frank", "Carolingian", "Charlemagne"],
  vikings: ["Viking", "Norse", "Dane"],
  "kievan-rus": ["Kievan", "Rus'"],
  normans: ["Norman"],
  "holy-roman-empire": ["Holy Roman"],
  "republic-of-florence": ["Florence", "Florentine"],
  "house-of-medici": ["Medici"],
  "republic-of-venice": ["Venice", "Venetian"],
  "papal-states": ["Papal", "Pope", "papacy"],
  "portuguese-empire": ["Portugal", "Portuguese"],
  "spanish-empire": ["Spain", "Spanish"],
  "dutch-republic": ["Dutch", "Netherlands"],
  "habsburg-monarchy": ["Habsburg", "Austria"],
  "ottoman-empire": ["Ottoman", "Turk"],
  "polish-lithuanian-commonwealth": ["Poland", "Polish", "Lithuania"],
  "swedish-empire": ["Sweden", "Swedish"],
  "kingdom-of-france": ["France", "French"],
  "kingdom-of-great-britain": ["Britain", "British", "England", "English", "Scotland"],
  "kingdom-of-prussia": ["Prussia"],
  "russian-empire": ["Russia"],
  "french-first-republic": ["France", "French"],
  "first-french-empire": ["France", "French", "Napoleon"],
  "austrian-empire": ["Austria"],
  "united-kingdom-gbi": ["Britain", "British", "England", "English", "United Kingdom"],
  "german-empire": ["German", "Prussia"],
  "french-third-republic": ["France", "French"],
  "british-empire": ["Britain", "British", "England", "United Kingdom"],
  "french-colonial-empire": ["France", "French"],
  "austria-hungary": ["Austria", "Austro"],
  "kingdom-of-italy": ["Italy", "Italian"],
  "weimar-republic": ["Weimar", "German"],
  "nazi-germany": ["Nazi", "German", "Hitler", "Wehrmacht"],
  "fascist-italy": ["Italy", "Italian", "Mussolini"],
  "second-polish-republic": ["Poland", "Polish"],
  "soviet-union": ["Soviet", "USSR", "Stalin", "Red Army"],
  nato: ["NATO"],
  "warsaw-pact": ["Warsaw Pact", "Eastern Bloc"],
  "west-germany": ["West German", "Federal Republic of Germany", "West Berlin"],
  "east-germany": ["East German", "German Democratic", "GDR"],
  "european-union": ["European Union", "European Communities", "European Economic"],
  russia: ["Russia"],
  germany: ["Germany", "German"],
  ukraine: ["Ukraine", "Ukrainian"],
};

// Successive or overlapping incarnations of the same polity. When an event
// matches several members of a family, only the era-correct one lights up
// (members tied for closest period all stay — e.g. both Cold-War Germanies).
const CIV_FAMILY: Record<string, string> = {
  "kingdom-of-great-britain": "britain",
  "united-kingdom-gbi": "britain",
  "british-empire": "britain",
  "kingdom-of-france": "france",
  "french-first-republic": "france",
  "first-french-empire": "france",
  "french-third-republic": "france",
  "french-colonial-empire": "france",
  "kingdom-of-prussia": "germany",
  "german-empire": "germany",
  "weimar-republic": "germany",
  "nazi-germany": "germany",
  "west-germany": "germany",
  "east-germany": "germany",
  germany: "germany",
  "russian-empire": "russia",
  "soviet-union": "russia",
  russia: "russia",
  "kingdom-of-italy": "italy",
  "fascist-italy": "italy",
  "habsburg-monarchy": "austria",
  "austrian-empire": "austria",
  "austria-hungary": "austria",
  "polish-lithuanian-commonwealth": "poland",
  "second-polish-republic": "poland",
};

// compact display names for narrow bands at far zoom (display-only)
const SHORT: Record<string, string> = {
  "ancient-europe": "Antiquity",
  "middle-ages": "Middle Ages",
  renaissance: "Renaissance",
  "age-of-exploration": "Exploration",
  reformation: "Reformation",
  enlightenment: "Enlightenment",
  "revolutionary-era": "Revolutions",
  "industrial-revolution": "Industry",
  "age-of-imperialism": "Empire",
  "world-wars": "World Wars",
  "cold-war": "Cold War",
  "contemporary-europe": "Today",
};

type BarNode = {
  el: HTMLElement;
  inner: HTMLElement;
  x: number;
  w: number;
  iw: number; // full label width
  nw: number; // name-only width
  sw2: number; // short-name width (Infinity when no short name)
};
type EvNode = { el: HTMLElement; x: number; row: number };

export default function Frieze({ data, filter, focus, onSelect }: VariantProps) {
  const { periods, civilizations } = data;
  // off-frieze world events exist only to anchor causal chains
  const events = useMemo(
    () => data.events.filter((e) => e.onTimeline),
    [data.events]
  );
  const [lod, setLod] = useState(0);
  const [stageH, setStageH] = useState(700);
  const [visCivs, setVisCivs] = useState<string[] | null>(null);
  const [ticks, setTicks] = useState<number[]>([]);
  const lodRef = useRef(0);
  const rafRef = useRef(0);
  const washRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<BarNode[]>([]);
  const evsRef = useRef<EvNode[]>([]);
  const civElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const periodElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const ticksKeyRef = useRef("");
  const visKeyRef = useRef("");
  const laneRef = useRef<Map<string, number>>(new Map());

  // write-only per-frame pass: ticks, edge-clamped labels, label decluttering.
  // All measurements are cached up front — no layout reads in here.
  const update = (el: HTMLElement, t: ZoomState) => {
    const vw = el.clientWidth;

    const yA = uToYear(clamp((0 - t.x) / (t.k * WORLD), 0, 1));
    const yB = uToYear(clamp((vw - t.x) / (t.k * WORLD), 0, 1));
    const next = generateTicks(yA, yB, t.k * WORLD, 120);
    const key = `${next[0]}_${next[next.length - 1]}_${next.length}`;
    if (key !== ticksKeyRef.current) {
      ticksKeyRef.current = key;
      setTicks(next);
    }

    // lanes pack against the visible window, not all of history — fewer
    // concurrent bars means room for generous spacing and portraits
    const margin = (yB - yA) * 0.08;
    const va = yA - margin;
    const vb = yB + margin;
    const vis = civilizations
      .filter((c) => c.endYear >= va && c.startYear <= vb)
      .map((c) => c.slug);
    const vKey = vis.join(",");
    if (vKey !== visKeyRef.current) {
      visKeyRef.current = vKey;
      setVisCivs(vis);
    }

    for (const b of barsRef.current) {
      const sx = b.x * t.k + t.x;
      const sw = b.w * t.k;
      if (sx > vw + 60 || sx + sw < -60) continue;
      const full = b.iw + 12 <= sw;
      const nameOnly = !full && b.nw <= sw;
      const shortOnly = !full && !nameOnly && b.sw2 <= sw;
      const any = full || nameOnly || shortOnly;
      b.el.classList.toggle("fit-off", !any);
      b.el.classList.toggle("dt-off", nameOnly || shortOnly);
      b.el.classList.toggle("ns-on", shortOnly);
      const need = full ? b.iw : nameOnly ? b.nw : b.sw2;
      let shift = 0;
      if (any && sx < 10)
        shift = Math.min(10 - sx, Math.max(0, sw - need - 16));
      b.inner.style.transform = shift > 0 ? `translateX(${shift}px)` : "";
    }

    const last = [-1e9, -1e9];
    for (const ev of evsRef.current) {
      const sx = ev.x * t.k + t.x;
      const show = sx - last[ev.row] >= 150;
      if (show) last[ev.row] = sx;
      ev.el.classList.toggle("lbl-off", !show);
    }
  };

  const { ref, setTransform, getTransform, setScaleExtent } = useZoom<HTMLDivElement>({
    scaleExtent: [0.3, 320],
    translateExtent: [
      [-260, -Infinity],
      [WORLD + 260, Infinity],
    ],
    onChange: (t) => {
      const el = ref.current;
      if (!el) return;
      el.style.setProperty("--k", String(t.k));
      el.style.setProperty("--tx", String(t.x));
      if (washRef.current)
        washRef.current.style.transform = `translate3d(${t.x}px, 0, 0) scaleX(${t.k})`;
      const l = t.k < 1.7 ? 0 : t.k < 5 ? 1 : 2;
      if (l !== lodRef.current) {
        lodRef.current = l;
        setLod(l);
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => update(el, t));
    },
  });

  const collect = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("measuring"); // forces .ns visible for measurement
    barsRef.current = Array.from(
      el.querySelectorAll<HTMLElement>("[data-cx]")
    ).map((node) => {
      node.classList.remove("fit-off", "dt-off", "ns-on");
      const inner = node.firstElementChild as HTMLElement;
      const nmW = inner?.querySelector<HTMLElement>(".nm")?.offsetWidth ?? 0;
      const dtW = inner?.querySelector<HTMLElement>(".dt")?.offsetWidth ?? 0;
      const nsW = inner?.querySelector<HTMLElement>(".ns")?.offsetWidth ?? 0;
      const isPeriod = node.classList.contains("va-period");
      const pad1 = isPeriod ? 36 : 56;
      const pad2 = isPeriod ? 48 : 72;
      return {
        el: node,
        inner,
        x: Number(node.dataset.cx),
        w: Number(node.dataset.cw),
        iw: nmW + dtW + pad2,
        nw: nmW + pad1,
        sw2: nsW > 0 ? nsW + 26 : Infinity,
      };
    });
    el.classList.remove("measuring");
    evsRef.current = Array.from(el.querySelectorAll<HTMLElement>(".va-ev")).map(
      (node) => ({
        el: node,
        x: Number(node.dataset.ex),
        row: Number(node.dataset.row),
      })
    );
    civElsRef.current = new Map(
      Array.from(el.querySelectorAll<HTMLElement>(".va-civ[data-slug]")).map(
        (n) => [n.dataset.slug as string, n]
      )
    );
    periodElsRef.current = new Map(
      Array.from(
        el.querySelectorAll<HTMLElement>(".va-period[data-pslug]")
      ).map((n) => [n.dataset.pslug as string, n])
    );
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    collect();
    setStageH(el.clientHeight);
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      collect(); // re-measure once the serif face is in
      update(el, getTransform());
    });
    const vw = el.clientWidth;
    // fit the inhabited span edge-to-edge — no dead margins
    const xa = X(Math.min(...periods.map((p) => p.startYear)));
    const xb = X(Math.max(...periods.map((p) => p.endYear)));
    const k0 = vw / (xb - xa);
    setScaleExtent(k0 * 0.999, 320); // can't zoom out past the full sweep
    setTransform(k0 * 1.05, -xa * k0 * 1.05 + (vw - (xb - xa) * k0 * 1.05) / 2, 0, 0);
    setTransform(k0, -xa * k0, 0, 1.0);
    gsap.to(el, { opacity: 1, duration: 0.6, ease: "power2.out" });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dive = (a: number, b: number) => {
    const el = ref.current;
    if (!el) return;
    const vw = el.clientWidth;
    const xa = X(a);
    const xb = X(b);
    const k = clamp((vw - 150) / (xb - xa), 0.3, 320);
    const x = (vw - (xb - xa) * k) / 2 - xa * k;
    setTransform(k, x, 0, 1.1);
  };

  useEffect(() => {
    if (!filter) return;
    if (filter.kind === "period") {
      const p = periods.find((x) => x.slug === filter.slug);
      if (p) dive(p.startYear, p.endYear);
    } else {
      const c = civilizations.find((x) => x.slug === filter.slug);
      if (c) {
        const [s, e] = civSpan(c);
        const pad = Math.max((e - s) * 0.2, 8);
        dive(s - pad, e + pad);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (focus) dive(focus.a, focus.b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const washGradient = useMemo(() => {
    const stops: string[] = [];
    for (const p of periods) {
      const a = (yearToU(p.startYear) * 100).toFixed(2);
      const b = (yearToU(p.endYear) * 100).toFixed(2);
      stops.push(
        `transparent ${a}%`,
        `color-mix(in srgb, ${p.color} 7%, transparent) ${a}%`,
        `color-mix(in srgb, ${p.color} 7%, transparent) ${b}%`,
        `transparent ${b}%`
      );
    }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [periods]);

  const periodBySlug = useMemo(
    () => new Map(periods.map((p) => [p.slug, p])),
    [periods]
  );
  const periodLanes = useMemo(
    () => packLanes(periods, (p) => p.startYear, (p) => p.endYear),
    [periods]
  );
  const { laneMap, laneCount } = useMemo(() => {
    const set = visCivs ? new Set(visCivs) : null;
    const active = set
      ? civilizations.filter((c) => set.has(c.slug))
      : civilizations;
    // gap 0 lets successor states chain on one lane (1800→1801 reads as a relay)
    const lanes = packLanes(
      active,
      (c) => civSpan(c)[0],
      (c) => civSpan(c)[1],
      0
    );
    const m = new Map(laneRef.current); // off-screen bars keep their last lane
    active.forEach((c, i) => m.set(c.slug, lanes[i]));
    laneRef.current = m;
    return {
      laneMap: m,
      laneCount: lanes.length ? Math.max(...lanes) + 1 : 1,
    };
  }, [visCivs, civilizations]);

  // generous lanes when the view allows; slim lifelines when it doesn't
  const laneH = useMemo(() => {
    const zoneTop = lod === 0 ? 252 : 170; // compact period shelf when dived
    const zone = stageH * 0.8 - zoneTop - 6;
    return clamp(Math.floor(zone / Math.max(1, laneCount)), 14, 34);
  }, [stageH, lod, laneCount]);

  // re-measure label widths after the density mode settles
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    collect();
    update(el, getTransform());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneH, lod]);

  const evCivs = useMemo(() => {
    const regs = civilizations.map((c) => ({
      c,
      re: new RegExp(`\\b(?:${(CIV_TOKENS[c.slug] ?? [c.name]).join("|")})`),
    }));
    const pBy = new Map(periods.map((p) => [p.slug, p]));
    const cBy = new Map(civilizations.map((c) => [c.slug, c]));
    const map = new Map<string, string[]>();
    for (const e of events) {
      const hay = `${e.name} ${e.description ?? ""} ${e.summary ?? ""}`;
      const y0 = e.year;
      const y1 = e.endYear ?? e.year;
      const out = new Set<string>();
      if (e.civSlug) out.add(e.civSlug);
      for (const { c, re } of regs) {
        if (c.endYear < y0 || c.startYear > y1) continue; // not alive then
        if (out.has(c.slug)) continue;
        if (re.test(hay)) out.add(c.slug);
      }
      // within a polity family, keep only the era-correct incarnation(s)
      if (out.size > 1) {
        const byFam = new Map<string, string[]>();
        for (const slug of out) {
          const fam = CIV_FAMILY[slug];
          if (fam) byFam.set(fam, [...(byFam.get(fam) ?? []), slug]);
        }
        for (const members of byFam.values()) {
          if (members.length < 2) continue;
          const dist = (slug: string) => {
            const p = pBy.get(cBy.get(slug)?.periodSlug ?? "");
            if (!p) return Infinity;
            return Math.max(p.startYear - e.year, e.year - p.endYear, 0);
          };
          const min = Math.min(...members.map(dist));
          for (const m of members) {
            if (m === e.civSlug) continue; // explicit link always stays
            if (dist(m) > min) out.delete(m);
          }
        }
      }
      if (out.size) map.set(e.slug, [...out]);
    }
    return map;
  }, [events, civilizations, periods]);

  const evEnter = (slug: string, periodSlug: string) => {
    const el = ref.current;
    if (!el) return;
    const civs = evCivs.get(slug);
    if (civs?.length) {
      el.classList.add("ev-hover");
      for (const cs of civs) civElsRef.current.get(cs)?.classList.add("lit");
    } else {
      // no known players — answer with the event's period instead
      periodElsRef.current.get(periodSlug)?.classList.add("lit");
    }
  };
  const evLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("ev-hover");
    el.querySelectorAll(".lit").forEach((n) => n.classList.remove("lit"));
  };

  const filterCivPeriod = useMemo(
    () =>
      filter?.kind === "civilization"
        ? civilizations.find((c) => c.slug === filter.slug)?.periodSlug
        : undefined,
    [filter, civilizations]
  );
  const matchPeriod = (slug: string) =>
    !filter ||
    (filter.kind === "period" ? filter.slug === slug : filterCivPeriod === slug);
  const matchCiv = (c: Civilization) =>
    !filter ||
    (filter.kind === "period"
      ? c.periodSlug === filter.slug
      : c.slug === filter.slug);
  const matchEv = (e: HistoricalEvent) =>
    !filter ||
    (filter.kind === "period"
      ? e.periodSlug === filter.slug
      : e.civSlug === filter.slug);

  return (
    <div
      ref={ref}
      className="va-viewport"
      data-lod={lod}
      data-dense={laneH < 20 ? "1" : undefined}
      style={{ opacity: 0, "--laneH": laneH } as React.CSSProperties}
    >
      <div
        ref={washRef}
        className="wash-strip"
        style={{ width: WORLD, height: "100%", background: washGradient }}
      />

      {periods.map((p, i) => (
        <button
          key={p.slug}
          className={`va-x va-span va-period ${matchPeriod(p.slug) ? "" : "dimmed"}`}
          style={
            {
              "--x": X(p.startYear),
              "--w": X(p.endYear) - X(p.startYear),
              "--c": p.color,
              "--plane": periodLanes[i],
            } as React.CSSProperties
          }
          data-cx={X(p.startYear)}
          data-cw={X(p.endYear) - X(p.startYear)}
          data-pslug={p.slug}
          onClick={() => dive(p.startYear, p.endYear)}
        >
          <span className="inner">
            <span className="nm">{p.name}</span>
            <span className="ns">{SHORT[p.slug] ?? p.name}</span>
            <span className="dt">{fmtSpan(p.startYear, p.endYear)}</span>
          </span>
        </button>
      ))}

      {civilizations.map((c, i) => {
        const [s, e] = civSpan(c);
        const color = periodBySlug.get(c.periodSlug)?.color ?? "#c8a55f";
        return (
          <button
            key={c.slug}
            className={`va-x va-span va-civ ${matchCiv(c) ? "" : "dimmed"}`}
            style={
              {
                "--x": X(s),
                "--w": X(e) - X(s),
                "--c": color,
                "--lane": laneMap.get(c.slug) ?? 0,
              } as React.CSSProperties
            }
            data-cx={X(s)}
            data-cw={X(e) - X(s)}
            data-slug={c.slug}
            onClick={() => onSelect({ type: "civilization", slug: c.slug })}
          >
            <span className="inner">
              {c.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbAt(c.thumbUrl, 120, c.imageW) ?? undefined}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const t = e.currentTarget;
                    if (c.thumbUrl && t.src !== c.thumbUrl) t.src = c.thumbUrl;
                  }}
                />
              )}
              <span className="nm">{c.name}</span>
              <span className="dt">{fmtSpan(c.startYear, c.endYear)}</span>
            </span>
          </button>
        );
      })}

      <div className="va-axis" />
      {ticks.map((y) => (
        <div
          key={y}
          className="va-x va-tick"
          style={{ "--x": X(y) } as React.CSSProperties}
        >
          <span>{fmtYear(y)}</span>
        </div>
      ))}

      {events.map((e, i) => {
        const color = periodBySlug.get(e.periodSlug)?.color ?? "#c8a55f";
        return (
          <button
            key={e.slug}
            className={`va-x va-ev ${matchEv(e) ? "" : "dimmed"}`}
            style={
              {
                "--x": X(e.year),
                "--row": i % 2,
                "--c": color,
              } as React.CSSProperties
            }
            data-ex={X(e.year)}
            data-row={i % 2}
            onMouseEnter={() => evEnter(e.slug, e.periodSlug)}
            onMouseLeave={evLeave}
            onClick={() => onSelect({ type: "event", slug: e.slug })}
          >
            {e.endYear != null && (
              <i
                className="range"
                style={
                  { "--w": X(e.endYear) - X(e.year) } as React.CSSProperties
                }
              />
            )}
            <i className="stem" />
            <b className="dot" />
            <span className="lbl">
              <span className="nm">{e.name}</span>
              <span className="dt">{fmtSpan(e.year, e.endYear)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
