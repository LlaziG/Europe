"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { CauseGraph, CauseNode } from "@/lib/types";
import { useZoom } from "@/components/timeline/useZoom";
import { fmtCauseYear } from "./useCauseGraph";

const COL_W = 250; // horizontal slot per node within a layer
const ROW_H = 150; // vertical gap between causal depths
const TOP = 60;

type Placed = CauseNode & { x: number; y: number };

// Sugiyama-style layered layout: depth = layer (root at the bottom), node
// order within each layer relaxed by barycenter sweeps to minimise crossings,
// connectors drawn as rounded orthogonal elbows.
function layeredLayout(graph: CauseGraph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const maxDepth = Math.max(1, ...graph.nodes.map((n) => n.depth ?? 0));

  const layers: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of graph.nodes) layers[n.depth ?? 0].push(n.id);

  const neighbours = new Map<number, number[]>();
  for (const e of graph.edges) {
    (neighbours.get(e.from) ?? neighbours.set(e.from, []).get(e.from)!).push(e.to);
    (neighbours.get(e.to) ?? neighbours.set(e.to, []).get(e.to)!).push(e.from);
  }

  const worldW = Math.max(...layers.map((l) => l.length)) * COL_W + COL_W;
  const xOf = new Map<number, number>();
  const layerX = (layer: number[]) => {
    const total = layer.length * COL_W;
    const start = worldW / 2 - total / 2 + COL_W / 2;
    layer.forEach((id, i) => xOf.set(id, start + i * COL_W));
  };
  // seed by year, then relax
  for (const layer of layers) {
    layer.sort((a, b) => byId.get(a)!.year - byId.get(b)!.year);
    layerX(layer);
  }
  for (let iter = 0; iter < 8; iter++) {
    const order = iter % 2 ? [...layers].reverse() : layers;
    for (const layer of order) {
      if (layer.length < 2) continue;
      const bary = new Map<number, number>();
      for (const id of layer) {
        const ns = neighbours.get(id) ?? [];
        const xs = ns.map((m) => xOf.get(m)).filter((v): v is number => v != null);
        bary.set(id, xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : xOf.get(id)!);
      }
      layer.sort(
        (a, b) => bary.get(a)! - bary.get(b)! || byId.get(a)!.year - byId.get(b)!.year
      );
      layerX(layer);
    }
  }

  const placed: Placed[] = graph.nodes.map((n) => ({
    ...n,
    x: xOf.get(n.id)!,
    y: TOP + (maxDepth - (n.depth ?? 0)) * ROW_H,
  }));
  return { placed, worldW, worldH: TOP + maxDepth * ROW_H + 120 };
}

// rounded orthogonal elbow from a cause (upper) down into its effect (lower)
function elbow(ax: number, ay: number, bx: number, by: number): string {
  const r = 12;
  if (Math.abs(ax - bx) < 2) return `M ${ax} ${ay} L ${bx} ${by}`;
  const midY = (ay + by) / 2;
  const s = bx > ax ? 1 : -1;
  return [
    `M ${ax} ${ay}`,
    `L ${ax} ${midY - r}`,
    `Q ${ax} ${midY} ${ax + s * r} ${midY}`,
    `L ${bx - s * r} ${midY}`,
    `Q ${bx} ${midY} ${bx} ${midY + r}`,
    `L ${bx} ${by}`,
  ].join(" ");
}

export default function TraceView({
  graph,
  initialPath,
  onPathChange,
  onOpenEvent,
  onClose,
}: {
  graph: CauseGraph;
  initialPath?: string[];
  onPathChange?: (slugs: string[]) => void;
  onOpenEvent: (slug: string) => void;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const slugToId = useMemo(
    () => new Map(graph.nodes.map((n) => [n.slug, n.id])),
    [graph]
  );

  const seedTrail = useMemo(() => {
    const ids = (initialPath ?? [])
      .map((s) => slugToId.get(s))
      .filter((v): v is number => v != null);
    const t = ids[0] === graph.rootId ? ids : [graph.rootId, ...ids];
    return t.length ? t : [graph.rootId];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [trail, setTrail] = useState<number[]>(seedTrail);
  const [focusId, setFocusId] = useState<number>(seedTrail[seedTrail.length - 1]);

  // report the walked path upward for the shareable URL
  useEffect(() => {
    onPathChange?.(trail.map((id) => byId.get(id)!.slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail]);

  const causesOf = useMemo(() => {
    const m = new Map<number, { node: CauseNode; sentence: string; score: number }[]>();
    for (const e of graph.edges) {
      const node = byId.get(e.from);
      if (!node) continue;
      (m.get(e.to) ?? m.set(e.to, []).get(e.to)!).push({
        node,
        sentence: e.sentence,
        score: e.score,
      });
    }
    for (const arr of m.values())
      arr.sort((a, b) => b.score - a.score || b.node.year - a.node.year);
    return m;
  }, [graph, byId]);

  const { placed, worldW, worldH } = useMemo(() => layeredLayout(graph), [graph]);
  const posById = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  const applyTransform = useCallback((t: { k: number; x: number; y: number }) => {
    if (worldRef.current)
      worldRef.current.style.transform = `translate3d(${t.x}px,${t.y}px,0) scale(${t.k})`;
  }, []);
  const { ref, setTransform, getTransform } = useZoom<HTMLDivElement>({
    scaleExtent: [0.15, 4],
    onChange: applyTransform,
  });

  const centerOn = useCallback(
    (id: number, k: number, dur = 0.7) => {
      const el = ref.current;
      const p = posById.get(id);
      if (!el || !p) return;
      setTransform(k, el.clientWidth / 2 - p.x * k, el.clientHeight * 0.6 - p.y * k, dur);
    },
    [posById, ref, setTransform]
  );
  const fitAll = useCallback(
    (dur = 0.7) => {
      const el = ref.current;
      if (!el) return;
      const k = Math.max(
        0.15,
        Math.min(1.4, (el.clientWidth - 80) / worldW, (el.clientHeight - 80) / worldH)
      );
      setTransform(k, (el.clientWidth - worldW * k) / 2, (el.clientHeight - worldH * k) / 2, dur);
    },
    [ref, setTransform, worldW, worldH]
  );
  const zoomBy = useCallback(
    (factor: number) => {
      const el = ref.current;
      if (!el) return;
      const t = getTransform();
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      const k = Math.max(0.15, Math.min(4, t.k * factor));
      setTransform(k, cx - ((cx - t.x) / t.k) * k, cy - ((cy - t.y) / t.k) * k, 0.25);
    },
    [getTransform, ref, setTransform]
  );
  const ensureVisible = useCallback(
    (id: number) => {
      const el = ref.current;
      const p = posById.get(id);
      if (!el || !p) return;
      const t = getTransform();
      const sx = p.x * t.k + t.x;
      const sy = p.y * t.k + t.y;
      const m = 100;
      if (sx > m && sx < el.clientWidth - m && sy > m && sy < el.clientHeight - m) return;
      setTransform(t.k, el.clientWidth / 2 - p.x * t.k, el.clientHeight * 0.6 - p.y * t.k, 0.6);
    },
    [posById, ref, getTransform, setTransform]
  );

  useEffect(() => {
    // start framed on the focus, leaning toward fitting the whole web if small
    if (placed.length <= 14) fitAll(0);
    else centerOn(focusId, 1, 0);
    gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = byId.get(focusId)!;
  const focusCauses = causesOf.get(focusId) ?? [];
  const reachesAntiquity = useMemo(() => graph.nodes.some((n) => n.year < 500), [graph]);

  const walkTo = (id: number) => {
    setFocusId(id);
    setTrail((t) => {
      const at = t.indexOf(id);
      return at >= 0 ? t.slice(0, at + 1) : [...t, id];
    });
    ensureVisible(id);
  };
  const backToStart = () => {
    setFocusId(graph.rootId);
    setTrail([graph.rootId]);
    centerOn(graph.rootId, getTransform().k, 0.7);
  };

  const close = () => {
    if (closing) return;
    setClosing(true);
    gsap.to(backdropRef.current, { opacity: 0, duration: 0.3, onComplete: onClose });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "Backspace" && trail.length > 1) {
        e.preventDefault();
        const t = trail.slice(0, -1);
        setTrail(t);
        setFocusId(t[t.length - 1]);
        ensureVisible(t[t.length - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail]);

  const causeIds = new Set(focusCauses.map((c) => c.node.id));
  const trailSet = new Set(trail);

  return (
    <div ref={backdropRef} className="tv-backdrop" onClick={close}>
      <div className="tv-shell" onClick={(e) => e.stopPropagation()}>
        <div className="tv-bar">
          <div className="tv-bar-l">
            <span className="ey">History, Backwards</span>
            <button
              className="tv-home"
              onClick={backToStart}
              disabled={focusId === graph.rootId}
              title="Return to the event you started from"
            >
              ↺ Back to start
            </button>
          </div>
          <div className="tv-crumbs">
            {trail.map((id, i) => {
              const n = byId.get(id)!;
              return (
                <span key={id} className="tv-crumb-wrap">
                  {i > 0 && <span className="tv-sep">›</span>}
                  <button
                    className={`tv-crumb ${id === focusId ? "on" : ""} ${i === 0 ? "origin" : ""}`}
                    onClick={() => walkTo(id)}
                  >
                    {i === 0 && <i>◆ </i>}
                    {n.name}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="tv-body">
          <div className="tv-canvas" ref={ref}>
            <div
              ref={worldRef}
              className="tv-world"
              style={{ width: worldW, height: worldH }}
            >
              <svg
                className="tv-arcs"
                width={worldW}
                height={worldH}
                viewBox={`0 0 ${worldW} ${worldH}`}
              >
                {graph.edges.map((e, i) => {
                  const a = posById.get(e.from); // cause (upper)
                  const b = posById.get(e.to); // effect (lower)
                  if (!a || !b) return null;
                  const onFocus = e.to === focusId;
                  const onTrail = trailSet.has(e.from) && trailSet.has(e.to);
                  return (
                    <path
                      key={i}
                      d={elbow(a.x, a.y + 18, b.x, b.y - 18)}
                      fill="none"
                      stroke={
                        onFocus
                          ? "#f0d99a"
                          : onTrail
                            ? "rgba(200,165,95,0.55)"
                            : "rgba(200,165,95,0.12)"
                      }
                      strokeWidth={onFocus ? 2.4 : onTrail ? 1.8 : 1}
                    />
                  );
                })}
              </svg>

              {placed.map((n) => {
                const isFocus = n.id === focusId;
                const isCause = causeIds.has(n.id);
                const isRoot = n.id === graph.rootId;
                const onTrail = trailSet.has(n.id);
                const cls = isFocus
                  ? "focus"
                  : isCause
                    ? "cause"
                    : onTrail
                      ? "trail"
                      : isRoot
                        ? "root"
                        : "dim";
                return (
                  <button
                    key={n.id}
                    className={`tv-chip ${cls}`}
                    style={{ left: n.x, top: n.y, "--c": n.color } as React.CSSProperties}
                    onClick={() => walkTo(n.id)}
                  >
                    {n.thumbUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={n.thumbUrl} alt="" loading="lazy" />
                    )}
                    <span className="tv-chip-txt">
                      <span className="yr">{fmtCauseYear(n.year)}</span>
                      <span className="nm">{n.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="tv-zoom">
              <button onClick={() => zoomBy(1.35)} aria-label="Zoom in">＋</button>
              <button onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out">－</button>
              <button onClick={() => fitAll()} aria-label="Fit all" title="Fit the whole web">⤢</button>
            </div>
            <div className="tv-canvas-hint">
              drag to pan · scroll to zoom · glowing chip = where you are
            </div>
          </div>

          <div className="tv-read" key={focusId}>
            <div className="tv-read-head" style={{ "--c": focus.color } as React.CSSProperties}>
              {focus.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={focus.thumbUrl} alt="" />
              )}
              <div>
                <span className="yr">{fmtCauseYear(focus.year)}</span>
                <h3>{focus.name}</h3>
              </div>
            </div>

            <button className="tv-open" onClick={() => onOpenEvent(focus.slug)}>
              Open this event ↗
            </button>

            <div className="tv-causes-h">
              {focusCauses.length
                ? focusId === graph.rootId
                  ? "This happened because —"
                  : "And that, in turn, because —"
                : "— the documented trail ends here —"}
            </div>

            {focusCauses.map((c) => (
              <button key={c.node.id} className="tv-cause" onClick={() => walkTo(c.node.id)}>
                <span className="tv-cause-top">
                  <span className="yr">{fmtCauseYear(c.node.year)}</span>
                  <span className="nm">{c.node.name}</span>
                  <span className="go">walk ↘</span>
                </span>
                <span className="tv-cause-sentence">“{c.sentence}”</span>
              </button>
            ))}

            {!focusCauses.length && (
              <p className="tv-end">
                {focus.year < 500 || reachesAntiquity
                  ? "You have followed the chain into the ancient world — the cited record reaches back no further here."
                  : "No earlier cause is documented in the sources for this event."}
              </p>
            )}
          </div>
        </div>
      </div>
      <button className="th-close" onClick={close} aria-label="Close">
        ✕
      </button>
    </div>
  );
}
