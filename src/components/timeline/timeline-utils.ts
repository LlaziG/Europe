import type { Civilization } from "@/lib/types";

// Piecewise time scale: deep antiquity is gently compressed (like a museum
// wall timeline) so the modern eras aren't slivers when zoomed out. The
// year-ruler is generated in year-space, so every label remains date-true.
const ANCHORS: [number, number][] = [
  [-3300, 0],
  [-800, 0.07],
  [0, 0.16],
  [476, 0.24],
  [1000, 0.33],
  [1453, 0.43],
  [1648, 0.54],
  [1789, 0.63],
  [1914, 0.79],
  [1945, 0.87],
  [1991, 0.94],
  [2060, 1],
];

export const T0 = ANCHORS[0][0];
export const T1 = ANCHORS[ANCHORS.length - 1][0];

export function yearToU(y: number): number {
  if (y <= T0) return 0;
  if (y >= T1) return 1;
  for (let i = 1; i < ANCHORS.length; i++) {
    if (y <= ANCHORS[i][0]) {
      const [y0, u0] = ANCHORS[i - 1];
      const [y1, u1] = ANCHORS[i];
      return u0 + ((y - y0) / (y1 - y0)) * (u1 - u0);
    }
  }
  return 1;
}

export function uToYear(u: number): number {
  if (u <= 0) return T0;
  if (u >= 1) return T1;
  for (let i = 1; i < ANCHORS.length; i++) {
    if (u <= ANCHORS[i][1]) {
      const [y0, u0] = ANCHORS[i - 1];
      const [y1, u1] = ANCHORS[i];
      return y0 + ((u - u0) / (u1 - u0)) * (y1 - y0);
    }
  }
  return T1;
}

export function fmtYear(y: number): string {
  const r = Math.round(y);
  if (r < 0) return `${-r} BC`;
  if (r <= 1000) return `AD ${r}`;
  return `${r}`;
}

export function fmtSpan(a: number, b?: number | null): string {
  if (b == null || b === a) return fmtYear(a);
  return `${fmtYear(a)} – ${fmtYear(b)}`;
}

// Greedy interval lane packing. Returns a lane index per item (input order).
export function packLanes<T>(
  items: T[],
  getStart: (t: T) => number,
  getEnd: (t: T) => number,
  gap = 0,
  maxLanes = Infinity
): number[] {
  const order = items
    .map((_, i) => i)
    .sort((a, b) => getStart(items[a]) - getStart(items[b]));
  const laneEnds: number[] = [];
  const lanes = new Array<number>(items.length).fill(0);
  for (const idx of order) {
    const s = getStart(items[idx]);
    const e = getEnd(items[idx]);
    let lane = laneEnds.findIndex((le) => s >= le + gap);
    if (lane === -1) {
      if (laneEnds.length < maxLanes) {
        lane = laneEnds.length;
        laneEnds.push(e);
      } else {
        // overflow: reuse the lane that frees up first
        lane = laneEnds.indexOf(Math.min(...laneEnds));
        laneEnds[lane] = e;
      }
    } else {
      laneEnds[lane] = e;
    }
    lanes[idx] = lane;
  }
  return lanes;
}

export function tickStepForSpan(visibleYears: number, targetTicks = 10): number {
  const raw = Math.max(1, visibleYears / targetTicks);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  for (const s of steps) if (s >= raw) return s;
  return 2000;
}

// Year-ruler ticks that respect the piecewise scale: each anchor segment gets
// its own step so labels never crowd in compressed stretches of the canvas.
export function generateTicks(
  yA: number,
  yB: number,
  pxPerU: number,
  minPx = 110
): number[] {
  const out: number[] = [];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [y0, u0] = ANCHORS[i - 1];
    const [y1, u1] = ANCHORS[i];
    const sA = Math.max(y0, yA);
    const sB = Math.min(y1, yB);
    if (sB <= sA) continue;
    const segPx = (u1 - u0) * pxPerU;
    const step = tickStepForSpan(y1 - y0, Math.max(1, segPx / minPx));
    for (let y = Math.ceil(sA / step) * step; y <= sB; y += step) {
      if (out.length === 0 || y > out[out.length - 1]) out.push(y);
    }
  }
  return out;
}

export const clamp = (v: number, a: number, b: number) =>
  Math.min(b, Math.max(a, v));

// Civilizations span their true dates on the timeline — no display clamping.
export function civSpan(c: Civilization): [number, number] {
  return [c.startYear, c.endYear];
}

// Commons metadata arrives messy: machine-readable Wikidata date syntax and
// filename-derived titles. Clean for display without touching the source.
export function cleanDateLabel(label: string | null): string | null {
  if (!label) return null;
  let s = label.split(/QS:/)[0];
  s = s.replace(/[+\-]\d{4,}-\d{2}-\d{2}T[\d:Z/.,+\-]*/g, "");
  s = s.replace(/\bdate\b\s*$/i, "");
  s = s.replace(/\s{2,}/g, " ").trim().replace(/[,;.(]+$/, "").trim();
  if (!s) return null;
  return s.length > 64 ? s.slice(0, 61) + "…" : s;
}

export function artDisplayTitle(title: string, story: string | null): string {
  const camel = /[a-z][A-Z]/.test(title);
  const codey =
    (/\d/.test(title) && (!title.includes(" ") || camel)) ||
    (!title.includes(" ") && title.length > 14 && camel);
  if (codey && story) {
    const first = story.split(/(?<=[.!?])\s/)[0];
    if (first && first.length >= 12)
      return first.length > 95
        ? first.slice(0, 92) + "…"
        : first.replace(/\.$/, "");
  }
  return title;
}

// Wikimedia only serves an allowlist of thumbnail widths — anything else
// returns HTTP 400. Snap requests to the nearest allowed bucket, and never
// request wider than the original image (that's also an error).
const THUMB_BUCKETS = [40, 60, 120, 250, 330, 500, 960, 1280];

export function thumbAt(
  url: string | null,
  w: number,
  origW?: number | null
): string | null {
  if (!url) return null;
  if (!/\/\d+px-/.test(url)) return url;
  const usable = THUMB_BUCKETS.filter((b) => !origW || b < origW);
  if (!usable.length) return url;
  const pick = usable.find((b) => b >= w) ?? usable[usable.length - 1];
  return url.replace(/\/\d+px-/, `/${pick}px-`);
}
