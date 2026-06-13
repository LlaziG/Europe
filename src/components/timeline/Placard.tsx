"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Selection, TimelinePayload } from "@/lib/types";
import { fmtSpan, thumbAt } from "./timeline-utils";
import { useCauseGraph } from "@/components/causes/useCauseGraph";
import TraceView from "@/components/causes/TraceView";

export default function Placard({
  sel,
  data,
  onClose,
  onPickEvent,
  traceOpen,
  tracePath,
  onOpenTrace,
  onCloseTrace,
  onTracePath,
}: {
  sel: NonNullable<Selection>;
  data: TimelinePayload;
  onClose: () => void;
  onPickEvent?: (slug: string) => void;
  traceOpen?: boolean;
  tracePath?: string[];
  onOpenTrace?: () => void;
  onCloseTrace?: () => void;
  onTracePath?: (path: string[]) => void;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const closingRef = useRef(false);
  const tracing = !!traceOpen;
  const causeSlug = sel.type === "event" ? sel.slug : null;
  const { graph, loading } = useCauseGraph(causeSlug);
  const hasCauses = !!graph && graph.edges.length > 0;

  // clicking "open this event" re-targets the placard so you can trace on;
  // falls back to its card route when no re-target handler is wired
  const openEventBySlug = (slug: string) => {
    onCloseTrace?.();
    if (onPickEvent) onPickEvent(slug);
    else window.location.href = `/event/${slug}`;
  };

  const target = useMemo(() => {
    if (sel.type === "civilization") {
      const c = data.civilizations.find((x) => x.slug === sel.slug);
      if (!c) return null;
      const p = data.periods.find((x) => x.slug === c.periodSlug);
      return {
        kind: "Civilization",
        name: c.name,
        dates: fmtSpan(c.startYear, c.endYear),
        description: c.description,
        summary: c.summary,
        thumbUrl: c.thumbUrl,
        imageUrl: c.imageUrl,
        imageW: c.imageW,
        artCount: c.artCount,
        wikiUrl: c.wikiUrl,
        periodName: p?.name ?? "",
        color: p?.color ?? "#c8a55f",
      };
    }
    const e = data.events.find((x) => x.slug === sel.slug);
    if (!e) return null;
    const p = data.periods.find((x) => x.slug === e.periodSlug);
    return {
      kind: "Major Event",
      name: e.name,
      dates: fmtSpan(e.year, e.endYear),
      description: e.description,
      summary: e.summary,
      thumbUrl: e.thumbUrl,
      imageUrl: e.imageUrl,
      imageW: e.imageW,
      artCount: e.artCount,
      wikiUrl: e.wikiUrl,
      periodName: p?.name ?? "",
      color: p?.color ?? "#c8a55f",
    };
  }, [sel, data]);

  // portrait with graceful degradation: bucketed thumb → stored thumb → original
  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => setImgIdx(0), [sel]);
  const sources = useMemo(() => {
    if (!target) return [];
    return Array.from(
      new Set(
        [
          thumbAt(target.thumbUrl, 960, target.imageW),
          target.thumbUrl,
          target.imageUrl,
        ].filter(Boolean)
      )
    ) as string[];
  }, [target]);
  const portrait = imgIdx < sources.length ? sources[imgIdx] : null;

  useEffect(() => {
    if (!backdropRef.current || !cardRef.current) return;
    gsap.fromTo(
      backdropRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.45, ease: "power2.out" }
    );
    gsap.fromTo(
      cardRef.current,
      { y: 34, opacity: 0, scale: 0.965 },
      { y: 0, opacity: 1, scale: 1, duration: 0.65, ease: "power3.out" }
    );
    const img = cardRef.current.querySelector(".pl-portrait img, .pl-fallback");
    if (img) {
      gsap.fromTo(
        img,
        { scale: 1.12, opacity: 0.4 },
        { scale: 1, opacity: 1, duration: 1.1, ease: "power3.out" }
      );
    }
  }, [sel]);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const tl = gsap.timeline({
      onComplete: () => {
        closingRef.current = false;
        onClose();
      },
    });
    tl.to(cardRef.current, {
      y: 22,
      opacity: 0,
      scale: 0.97,
      duration: 0.3,
      ease: "power2.in",
    }).to(backdropRef.current, { opacity: 0, duration: 0.25 }, "<0.05");
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // the trace overlay handles its own Escape; don't tear down the placard too
      if (ev.key === "Escape" && !tracing) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracing]);

  if (!target) return null;

  return (
    <div ref={backdropRef} className="pl-backdrop" onClick={close}>
      <article
        ref={cardRef}
        className="pl-card"
        style={{ "--c": target.color } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pl-rule" />
        <div className="pl-portrait">
          {portrait ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait}
              alt={target.name}
              onError={() => setImgIdx((i) => i + 1)}
            />
          ) : (
            <div className="pl-fallback">{target.name.charAt(0)}</div>
          )}
        </div>
        <div className="pl-body">
          <div className="pl-eyebrow">
            {target.kind} · {target.periodName}
          </div>
          <h2 className="pl-name">{target.name}</h2>
          {target.description && (
            <div className="pl-desc">{target.description}</div>
          )}
          <div className="pl-dates">{target.dates}</div>
          {target.summary && <p className="pl-summary">{target.summary}</p>}
        </div>
        {sel.type === "event" && (hasCauses || loading) && (
          <div className="pl-trace">
            <button
              className="pl-trace-btn"
              onClick={() => onOpenTrace?.()}
              disabled={loading || !hasCauses}
            >
              <span>
                ↑ Trace the causes
                <i>
                  {loading
                    ? "reading the record…"
                    : `back to ${graph!.nodes.reduce((m, n) => Math.min(m, n.year), 9999) < 500 ? "antiquity" : "its roots"} · ${graph!.nodes.length} events, ${graph!.edges.length} links`}
                </i>
              </span>
              <b>→</b>
            </button>
          </div>
        )}
        <footer className="pl-foot">
          {target.wikiUrl ? (
            <a href={target.wikiUrl} target="_blank" rel="noreferrer">
              Source · Wikipedia ↗
            </a>
          ) : (
            <span />
          )}
          {target.artCount > 0 ? (
            <a className="pl-enter" href={`/${sel.type}/${sel.slug}/museum`}>
              Enter Museum
              <span>
                first-person gallery · {target.artCount}{" "}
                {target.artCount === 1 ? "work" : "works"}
              </span>
            </a>
          ) : (
            <button className="pl-enter" disabled title="No freely-licensed works found yet">
              Enter Museum
              <span>collection in preparation</span>
            </button>
          )}
        </footer>
        <button className="pl-close" onClick={close} aria-label="Close">
          ✕
        </button>
      </article>

      {tracing && graph && (
        <div onClick={(e) => e.stopPropagation()}>
          <TraceView
            graph={graph}
            initialPath={tracePath}
            onPathChange={onTracePath}
            onOpenEvent={openEventBySlug}
            onClose={() => onCloseTrace?.()}
          />
        </div>
      )}
    </div>
  );
}
