"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { SearchResult } from "@/lib/types";
import { fmtSpan, thumbAt } from "./timeline-utils";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  period: "Periods",
  civilization: "Civilizations",
  event: "Major Events",
};

export default function SearchBox({
  onPick,
}: {
  onPick: (r: SearchResult) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = (val: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const query = val.trim();
      if (query.length < 2) {
        setResults([]);
        setOpen(false);
        return;
      }
      ctrlRef.current?.abort();
      ctrlRef.current = new AbortController();
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ctrlRef.current.signal,
        });
        const json = (await res.json()) as { results: SearchResult[] };
        setResults(json.results);
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted */
      }
    }, 180);
  };

  useEffect(() => {
    if (!open || !panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { y: -8, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }
    );
  }, [open, results]);

  const pick = (r: SearchResult) => {
    setOpen(false);
    setQ("");
    setResults([]);
    inputRef.current?.blur();
    onPick(r);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    if (!open || !results.length) {
      if (ev.key === "Escape") inputRef.current?.blur();
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      pick(results[active]);
    } else if (ev.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="sb">
      <i className="sb-glyph">⌕</i>
      <input
        ref={inputRef}
        className="sb-input"
        placeholder="Search all of history"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          run(e.target.value);
        }}
        onFocus={() => {
          if (results.length) setOpen(true);
        }}
        onKeyDown={onKey}
        spellCheck={false}
      />
      {open && (
        <>
          <div className="sb-overlay" onClick={() => setOpen(false)} />
          <div ref={panelRef} className="sb-panel">
            {results.length === 0 && (
              <div className="sb-empty">Nothing in the collection matches.</div>
            )}
            {results.map((r, i) => {
              const prev = results[i - 1];
              const header =
                r.source === "text"
                  ? !prev || prev.source !== "text"
                    ? "In the chronicles"
                    : null
                  : !prev || prev.kind !== r.kind || prev.source === "text"
                    ? KIND_LABEL[r.kind]
                    : null;
              return (
                <div key={`${r.source}-${r.kind}-${r.slug}`}>
                  {header && <div className="sb-sec">{header}</div>}
                  <button
                    className={`sb-row ${i === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(r)}
                  >
                    {r.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbAt(r.thumbUrl, 60) ?? undefined}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <span className="sb-noimg">◆</span>
                    )}
                    <span className="mid">
                      <span className="nm">{r.name}</span>
                      {r.source === "text" && r.sub && (
                        <span className="snip">
                          …
                          {r.sub
                            .split(/«|»/)
                            .map((part, pi) =>
                              pi % 2 ? <i key={pi}>{part}</i> : part
                            )}
                          …
                        </span>
                      )}
                    </span>
                    <span className="dt">{fmtSpan(r.startYear, r.endYear)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
