"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FocusTarget,
  SearchResult,
  Selection,
  TimelineFilter,
  TimelinePayload,
} from "@/lib/types";
import { type AppView, parseView, urlForView, viewToSelection } from "@/lib/appurl";
import Frieze from "./Frieze";
import Placard from "./Placard";
import FilterDropdown from "./FilterDropdown";
import SearchBox from "./SearchBox";

const HINTS = [
  "Scroll to zoom",
  "Drag to pan",
  "Click a period to dive",
  "Hover an event to light its players",
  "Click anything for its placard",
];

export default function TimelineApp({
  data,
  initialView,
}: {
  data: TimelinePayload;
  initialView?: AppView;
}) {
  const init = initialView ?? { kind: "none" };
  const [sel, setSel] = useState<Selection>(viewToSelection(init));
  const [traceOpen, setTraceOpen] = useState(init.kind === "trace");
  const [tracePath, setTracePath] = useState<string[]>(
    init.kind === "trace" ? init.path : []
  );
  const [filter, setFilter] = useState<TimelineFilter>(null);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const nonceRef = useRef(0);

  // ── shareable URLs via the History API (no remount of the canvas) ──
  const nav = useCallback((v: AppView, replace = false) => {
    const url = urlForView(v);
    if (typeof window === "undefined") return;
    if (window.location.pathname + window.location.search === url) {
      window.history.replaceState(null, "", url);
    } else if (replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }, []);

  // focus the timeline on an event/civ when a URL or search lands on it
  const focusEntity = useCallback(
    (slug: string, isEvent: boolean) => {
      nonceRef.current += 1;
      const e = isEvent
        ? data.events.find((x) => x.slug === slug)
        : null;
      const c = !isEvent
        ? data.civilizations.find((x) => x.slug === slug)
        : null;
      const a = e ? e.year : c ? c.startYear : null;
      const b = e ? (e.endYear ?? e.year) : c ? c.endYear : null;
      const pslug = e ? e.periodSlug : c ? c.periodSlug : null;
      if (a != null && b != null) {
        const pad = Math.max((b - a) * 0.5, 14);
        setFocus({ a: a - pad, b: b + pad, periodSlug: pslug, n: nonceRef.current });
      }
    },
    [data]
  );

  // on mount, frame whatever the entry URL pointed at
  useEffect(() => {
    if (init.kind === "card") focusEntity(init.slug, init.type === "event");
    else if (init.kind === "trace") focusEntity(init.slug, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // back/forward buttons restore the corresponding view
  useEffect(() => {
    const onPop = () => {
      const v = parseView(window.location.pathname, window.location.search);
      setSel(viewToSelection(v));
      setTraceOpen(v.kind === "trace");
      setTracePath(v.kind === "trace" ? v.path : []);
      if (v.kind !== "none") focusEntity(v.slug, v.kind === "trace" || v.type === "event");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [focusEntity]);

  const openCard = (s: Selection) => {
    setTraceOpen(false);
    setSel(s);
    nav(s ? { kind: "card", type: s.type, slug: s.slug } : { kind: "none" });
  };
  const closeCard = () => {
    setSel(null);
    setTraceOpen(false);
    nav({ kind: "none" });
  };
  const openTrace = () => {
    if (sel?.type !== "event") return;
    setTraceOpen(true);
    setTracePath([sel.slug]);
    nav({ kind: "trace", slug: sel.slug, path: [sel.slug] });
  };
  const closeTrace = () => {
    setTraceOpen(false);
    if (sel) nav({ kind: "card", type: sel.type, slug: sel.slug });
  };
  const onTracePath = (path: string[]) => {
    setTracePath(path);
    if (sel?.type === "event")
      nav({ kind: "trace", slug: sel.slug, path }, true); // replace: no history spam
  };

  const onSearchPick = (r: SearchResult) => {
    if (r.kind === "period") {
      setFilter({ kind: "period", slug: r.slug });
      return;
    }
    if (r.kind === "civilization") setFilter({ kind: "civilization", slug: r.slug });
    openCard({ type: r.kind, slug: r.slug });
    focusEntity(r.slug, r.kind === "event");
  };

  return (
    <div className="app-root">
      <header className="hdr">
        <div className="hdr-brand">
          <span className="hdr-word">
            EUROPA<i>.</i>
          </span>
          <span className="hdr-sub">A Museum of European History</span>
        </div>

        <div className="hdr-right">
          <SearchBox onPick={onSearchPick} />
          <FilterDropdown data={data} filter={filter} setFilter={setFilter} />
        </div>
      </header>

      <div className="stage">
        <Frieze data={data} filter={filter} focus={focus} onSelect={openCard} />
      </div>

      <div className="hints">
        {HINTS.map((h, i) => (
          <span key={h} style={{ display: "contents" }}>
            {i > 0 && <i>◆</i>}
            {h}
          </span>
        ))}
      </div>

      {sel && (
        <Placard
          sel={sel}
          data={data}
          onClose={closeCard}
          traceOpen={traceOpen}
          tracePath={tracePath}
          onOpenTrace={openTrace}
          onCloseTrace={closeTrace}
          onTracePath={onTracePath}
          onPickEvent={(slug) => {
            openCard({ type: "event", slug });
            focusEntity(slug, true);
          }}
        />
      )}
    </div>
  );
}
