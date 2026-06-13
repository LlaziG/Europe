export type Period = {
  id: number;
  slug: string;
  name: string;
  startYear: number;
  endYear: number;
  summary: string | null;
  description: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  imageW: number | null;
  imageH: number | null;
  wikiUrl: string | null;
  color: string;
  sort: number;
};

export type Civilization = {
  id: number;
  slug: string;
  name: string;
  periodSlug: string;
  startYear: number;
  endYear: number;
  displayStart: number | null;
  displayEnd: number | null;
  summary: string | null;
  description: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  imageW: number | null;
  imageH: number | null;
  wikiUrl: string | null;
  artCount: number;
};

export type HistoricalEvent = {
  id: number;
  slug: string;
  name: string;
  periodSlug: string;
  civSlug: string | null;
  year: number;
  endYear: number | null;
  summary: string | null;
  description: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  imageW: number | null;
  imageH: number | null;
  wikiUrl: string | null;
  artCount: number;
  onTimeline: boolean;
};

export type Artwork = {
  id: number;
  slug: string;
  title: string;
  artist: string | null;
  yearLabel: string | null;
  year: number | null;
  kind: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  story: string | null;
  license: string | null;
  credit: string | null;
  wikiUrl: string | null;
};

export type Chapter = {
  id: number;
  idx: number;
  title: string;
  body: string;
};

export type MuseumEntity = {
  kind: "civilization" | "event";
  slug: string;
  name: string;
  datesLabel: string;
  endYear: number;
  periodName: string;
  color: string;
  summary: string | null;
  wikiUrl: string | null;
};

export type TimelinePayload = {
  periods: Period[];
  civilizations: Civilization[];
  events: HistoricalEvent[];
};

export type Selection =
  | { type: "civilization"; slug: string }
  | { type: "event"; slug: string }
  | null;

export type TimelineFilter =
  | { kind: "period"; slug: string }
  | { kind: "civilization"; slug: string }
  | null;

// a one-shot "fly to this span" command (n is a nonce so repeats re-trigger)
export type FocusTarget = {
  a: number;
  b: number;
  periodSlug: string | null;
  n: number;
};

export type SearchResult = {
  kind: "period" | "civilization" | "event";
  slug: string;
  name: string;
  sub: string | null;
  startYear: number;
  endYear: number | null;
  thumbUrl: string | null;
  periodSlug: string | null;
  source: "name" | "text"; // matched by name, or found inside the chronicles
};

export type CauseNode = {
  id: number;
  slug: string;
  name: string;
  year: number;
  endYear: number | null;
  thumbUrl: string | null;
  periodSlug: string;
  color: string;
  depth?: number;
};

export type CauseEdge = {
  from: number; // cause
  to: number; // effect
  sentence: string;
  sourceSlug: string;
  score: number;
};

export type CauseGraph = {
  rootId: number;
  nodes: CauseNode[];
  edges: CauseEdge[];
};

export type VariantProps = {
  data: TimelinePayload;
  filter: TimelineFilter;
  focus?: FocusTarget | null;
  onSelect: (sel: Selection) => void;
};
