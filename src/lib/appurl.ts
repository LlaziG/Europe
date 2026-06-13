// Shareable URL model for the timeline overlays. Real routes back each shape
// (so a pasted link loads straight into it); in-app we sync with the History
// API so the timeline canvas never remounts.
import type { Selection } from "./types";

export type AppView =
  | { kind: "none" }
  | { kind: "card"; type: "civilization" | "event"; slug: string }
  | { kind: "trace"; slug: string; path: string[] };

export function urlForView(v: AppView): string {
  if (v.kind === "card") return `/${v.type}/${v.slug}`;
  if (v.kind === "trace") {
    const base = `/event/${v.slug}/trace`;
    const rest = v.path.filter((s) => s && s !== v.slug);
    return rest.length ? `${base}?path=${rest.join(",")}` : base;
  }
  return "/";
}

export function parseView(pathname: string, search: string): AppView {
  const sp = new URLSearchParams(search);
  let m = pathname.match(/^\/event\/([^/]+)\/trace\/?$/);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    const path = (sp.get("path") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { kind: "trace", slug, path: [slug, ...path.filter((s) => s !== slug)] };
  }
  m = pathname.match(/^\/event\/([^/]+)\/?$/);
  if (m) return { kind: "card", type: "event", slug: decodeURIComponent(m[1]) };
  m = pathname.match(/^\/civilization\/([^/]+)\/?$/);
  if (m)
    return { kind: "card", type: "civilization", slug: decodeURIComponent(m[1]) };
  return { kind: "none" };
}

export function viewToSelection(v: AppView): Selection {
  if (v.kind === "card") return { type: v.type, slug: v.slug };
  if (v.kind === "trace") return { type: "event", slug: v.slug };
  return null;
}
