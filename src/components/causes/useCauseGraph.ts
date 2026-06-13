"use client";

import { useEffect, useState } from "react";
import type { CauseGraph } from "@/lib/types";

export function useCauseGraph(slug: string | null) {
  const [graph, setGraph] = useState<CauseGraph | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) {
      setGraph(null);
      return;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/causes?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((g: CauseGraph) => {
        if (alive) setGraph(g);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [slug]);

  return { graph, loading };
}

export function fmtCauseYear(y: number): string {
  if (y < 0) return `${-y} BC`;
  if (y <= 1000) return `AD ${y}`;
  return String(y);
}
