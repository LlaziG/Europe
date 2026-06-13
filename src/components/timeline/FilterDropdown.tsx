"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { TimelineFilter, TimelinePayload } from "@/lib/types";
import { fmtSpan } from "./timeline-utils";

export default function FilterDropdown({
  data,
  filter,
  setFilter,
}: {
  data: TimelinePayload;
  filter: TimelineFilter;
  setFilter: (f: TimelineFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeName = useMemo(() => {
    if (!filter) return null;
    if (filter.kind === "period")
      return data.periods.find((p) => p.slug === filter.slug)?.name ?? null;
    return (
      data.civilizations.find((c) => c.slug === filter.slug)?.name ?? null
    );
  }, [filter, data]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    gsap.fromTo(
      panel,
      { clipPath: "inset(0 0 100% 0 round 14px)", opacity: 0.5 },
      {
        clipPath: "inset(0 0 0% 0 round 14px)",
        opacity: 1,
        duration: 0.55,
        ease: "power3.out",
      }
    );
    gsap.fromTo(
      panel.querySelectorAll(".fd-chip, .fd-row, .fd-sec, .fd-group-h"),
      { y: 12, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.45,
        stagger: 0.012,
        ease: "power2.out",
        delay: 0.08,
      }
    );
  }, [open]);

  const pick = (f: TimelineFilter) => {
    setFilter(f);
    setOpen(false);
  };

  return (
    <div className="fd">
      <button
        className={`fd-btn ${filter ? "active" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="nm">{activeName ?? "Filter the canvas"}</span>
        <i>◆</i>
        {filter && (
          <span
            className="fd-clear"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setFilter(null);
            }}
          >
            ✕
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fd-overlay" onClick={() => setOpen(false)} />
          <div ref={panelRef} className="fd-panel">
            <div className="fd-sec">By Period</div>
            <div className="fd-grid">
              {data.periods.map((p) => {
                const active =
                  filter?.kind === "period" && filter.slug === p.slug;
                return (
                  <button
                    key={p.slug}
                    className={`fd-chip ${active ? "active" : ""}`}
                    style={{ "--c": p.color } as React.CSSProperties}
                    onClick={() =>
                      pick(active ? null : { kind: "period", slug: p.slug })
                    }
                  >
                    <span className="swatch" />
                    <span>
                      <span className="nm">{p.name}</span>
                      <span className="dt">
                        {fmtSpan(p.startYear, p.endYear)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="fd-sec">By Civilization</div>
            {data.periods.map((p) => {
              const civs = data.civilizations.filter(
                (c) => c.periodSlug === p.slug
              );
              if (!civs.length) return null;
              return (
                <div
                  key={p.slug}
                  className="fd-group"
                  style={{ "--c": p.color } as React.CSSProperties}
                >
                  <div className="fd-group-h">{p.name}</div>
                  {civs.map((c) => {
                    const active =
                      filter?.kind === "civilization" &&
                      filter.slug === c.slug;
                    return (
                      <button
                        key={c.slug}
                        className={`fd-row ${active ? "active" : ""}`}
                        onClick={() =>
                          pick(
                            active
                              ? null
                              : { kind: "civilization", slug: c.slug }
                          )
                        }
                      >
                        <span className="nm">{c.name}</span>
                        <span className="dt">
                          {fmtSpan(c.startYear, c.endYear)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
