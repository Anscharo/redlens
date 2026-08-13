// Dynamic Open Graph card images.
//
// One 1200×630 layout — a red accent rule, an optional small-gray eyebrow, a
// big title line, and a brand footer — rendered per route via a CardSpec. In
// the app's palette (src/index.css tokens). satori lays the text out into SVG
// (with the bundled Inter fonts), resvg rasterizes it to PNG; both run under
// Bun. satori + resvg are imported lazily so the static hot path and boot don't
// pay for them, and a missing native binary degrades to a null return (the
// route then serves a static fallback) instead of crashing the server.

import { readFileSync } from "node:fs";

const WIDTH = 1200;
const HEIGHT = 630;
const TITLE_MAX = 90; // hard cap so pathological titles can't overflow the card
const NAME_MAX = 40; // actor/label cap inside a composed title line

// Palette (kept in sync with src/index.css).
const BG = "#160e0d";
const TAN = "#f3e7ce";
const TAN_3 = "#b8a48e";
const RED = "#a63228";
const ACCENT = "#c67267";

// One card per route kind. `doc` carries the resolved title/number (+ a preview
// label when the doc is viewed inside a preview); the rest carry only the
// dynamic string they need (actor / report / preview label).
export type CardSpec =
  | { kind: "default" }
  | { kind: "doc"; docNo: string; title: string; preview?: string }
  | { kind: "radar" }
  | { kind: "radarActor"; agent: string }
  | { kind: "reports" }
  | { kind: "report"; name: string }
  | { kind: "connect" }
  | { kind: "preview"; label: string };

// The subset of CardSpec reachable through the /api/og.png?kind=… query
// string. `doc` is out-of-band — it's served by /api/og/<id>.png (a resolved
// lookup, not a query param) — so it's excluded here rather than left for
// cardToQuery to reject at runtime.
//
// cardToQuery/cardFromQuery are a paired contract: og.ts builds every
// og:image URL by calling cardToQuery() on a CardSpec object literal, so a
// typo'd kind string is now a compile error there, not a silently-wrong URL.
// cardFromQuery is the HTTP-boundary decoder for /api/og.png — an external,
// possibly malformed request still degrades to the default card there; that
// degradation is correct for the boundary, it's the internal string-building
// that's been made impossible to typo.
export type QueryCardSpec = Exclude<CardSpec, { kind: "doc" }>;

// Encode a QueryCardSpec as the /api/og.png query string (always leads with
// `kind`, matching the shape cardFromQuery expects).
export function cardToQuery(spec: QueryCardSpec): string {
  switch (spec.kind) {
    case "radar":
      return "kind=radar";
    case "radarActor":
      return `kind=radar-actor&name=${encodeURIComponent(spec.agent)}`;
    case "reports":
      return "kind=reports";
    case "report":
      return `kind=report&name=${encodeURIComponent(spec.name)}`;
    case "connect":
      return "kind=connect";
    case "preview":
      return `kind=preview&label=${encodeURIComponent(spec.label)}`;
    case "default":
      return "kind=default";
    default: {
      // Exhaustiveness guard: a new QueryCardSpec variant with no case above
      // is a compile error here, not a silent default-card degradation.
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

// Fonts resolved relative to this module (not cwd) so the path holds wherever
// the server is launched from. Loaded once, lazily, on first render.
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;
function loadFonts() {
  if (fonts) return fonts;
  const p = (f: string) => new URL(`./fonts/${f}`, import.meta.url);
  fonts = [
    { name: "Inter", data: readFileSync(p("Inter-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Inter", data: readFileSync(p("Inter-SemiBold.ttf")), weight: 600, style: "normal" },
    { name: "Inter", data: readFileSync(p("Inter-Bold.ttf")), weight: 700, style: "normal" },
  ];
  return fonts;
}

export function truncateTitle(title: string, max = TITLE_MAX): string {
  const t = title.trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// Bigger titles for short strings, smaller for long ones, so the card always
// looks intentional rather than swimming in empty space or overflowing.
export function titleFontSize(len: number): number {
  if (len > 64) return 60;
  if (len > 40) return 78;
  if (len > 22) return 96;
  return 112;
}

// A styled run of text within a line.
type Seg = { t: string; c?: string; w?: number };

// A span's leading/trailing spaces collapse at the boundary with its neighbour
// under flexShrink:0, so convert only those edge spaces to non-breaking ones
// (internal spaces are left alone). flexShrink:0 itself stops a too-wide line
// from compressing its runs on top of each other.
const NBSP = String.fromCharCode(0xa0);
function nbspEdges(t: string): string {
  return t.replace(/^ +/, (m) => NBSP.repeat(m.length)).replace(/ +$/, (m) => NBSP.repeat(m.length));
}
function span(s: Seg) {
  const style: Record<string, unknown> = { flexShrink: 0 };
  if (s.c) style.color = s.c;
  if (s.w) style.fontWeight = s.w;
  return { type: "span", props: { style, children: nbspEdges(s.t) } };
}

// Font size that keeps a single-line multi-span title within the content width
// (a lone long string wraps on its own, but joined spans can't break mid-run).
function fitSize(len: number): number {
  return Math.max(44, Math.min(titleFontSize(len), Math.floor((WIDTH - 180) / (len * 0.56))));
}

function titleLine(segs: Seg[], fontSize?: number) {
  const len = segs.reduce((n, s) => n + s.t.length, 0);
  const base: Record<string, unknown> = { display: "flex", fontSize: fontSize ?? titleFontSize(len), fontWeight: 700, color: TAN, lineHeight: 1.13, marginBottom: "26px" };
  // A single run is a plain string child so satori text-wraps it; multiple runs
  // are spans laid out in a nowrap row (their internal spaces are preserved).
  if (segs.length === 1) {
    const s = segs[0];
    return { type: "div", props: { style: { ...base, ...(s.c ? { color: s.c } : {}), ...(s.w ? { fontWeight: s.w } : {}) }, children: s.t } };
  }
  return { type: "div", props: { style: base, children: segs.map(span) } };
}

function eyebrow(text: string, color = TAN_3, weight = 500) {
  return { type: "div", props: { style: { display: "flex", fontSize: 30, fontWeight: weight, color, letterSpacing: "0.06em", marginBottom: "14px" }, children: text } };
}

// A doc viewed inside a preview gets a prominent accent eyebrow so the card
// unmistakably reads as a preview rather than the live atlas.
function previewEyebrow(label: string) {
  const tag = label ? `PREVIEW · ${truncateTitle(label, NAME_MAX)}` : "PREVIEW";
  return eyebrow(tag, ACCENT, 700);
}

// Footer words are one span each, spaced by a flex `gap` (rather than literal
// spaces) so the wordmark reads with clear, even breathing room.
function footerLine(segs: Seg[]) {
  return { type: "div", props: { style: { display: "flex", gap: "0.34em", fontSize: 34, fontWeight: 400, color: TAN_3 }, children: segs.map(span) } };
}

// Shared footers, one span per word (the flex gap does the spacing).
const TAN6 = { c: TAN, w: 600 };
const RED6 = { c: RED, w: 600 };
const BY_REDLINE: Seg[] = [{ t: "By" }, { t: "Redline", ...RED6 }];
const BY_REDLINE_LC: Seg[] = [{ t: "by" }, { t: "Redline", ...RED6 }];
const SKY_ATLAS_BY_REDLINE: Seg[] = [{ t: "Sky", ...TAN6 }, { t: "Atlas", ...TAN6 }, { t: "by" }, { t: "Redline", ...RED6 }];
const SKY_ATLAS_REPORT_BY_REDLINE: Seg[] = [{ t: "Sky", ...TAN6 }, { t: "Atlas", ...TAN6 }, { t: "Report", ...TAN6 }, { t: "by" }, { t: "Redline", ...RED6 }];

// The lines (below the accent rule) for a given card.
function cardLines(spec: CardSpec): unknown[] {
  switch (spec.kind) {
    case "doc":
      return [
        ...(spec.preview ? [previewEyebrow(spec.preview)] : []),
        ...(spec.docNo ? [eyebrow(spec.docNo)] : []),
        titleLine([{ t: truncateTitle(spec.title), c: TAN }]),
        footerLine(SKY_ATLAS_BY_REDLINE),
      ];
    case "radar":
      return [titleLine([{ t: "Sky Atlas Radar", c: TAN }]), footerLine(BY_REDLINE)];
    case "radarActor": {
      const agent = truncateTitle(spec.agent || "Radar", NAME_MAX);
      const segs: Seg[] = [{ t: "Sky Atlas ", c: TAN_3 }, { t: agent, c: TAN, w: 700 }, { t: " Radar", c: TAN_3 }];
      return [titleLine(segs, fitSize("Sky Atlas  Radar".length + agent.length)), footerLine(BY_REDLINE)];
    }
    case "reports":
      return [titleLine([{ t: "Sky Atlas Reports", c: TAN }]), footerLine(BY_REDLINE)];
    case "report":
      return [titleLine([{ t: truncateTitle(spec.name || "Reports"), c: TAN }]), footerLine(SKY_ATLAS_REPORT_BY_REDLINE)];
    case "connect":
      return [eyebrow("Connect to"), titleLine([{ t: "Redline", c: RED }, { t: " Sky Atlas", c: TAN }]), footerLine([{ t: "MCP Server", c: TAN_3 }])];
    case "preview":
      return [eyebrow("Previewing"), titleLine([{ t: truncateTitle(spec.label || "a proposed change", NAME_MAX), c: TAN }]), footerLine(SKY_ATLAS_BY_REDLINE)];
    default:
      return [titleLine([{ t: "Sky Atlas", c: TAN }]), footerLine(BY_REDLINE_LC)];
  }
}

function cardNode(spec: CardSpec) {
  return {
    type: "div",
    props: {
      style: {
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        backgroundColor: BG,
        padding: "90px",
        fontFamily: "Inter",
      },
      children: [
        // Small red accent rule above the content — echoes the reader's red bar.
        { type: "div", props: { style: { width: "72px", height: "8px", backgroundColor: RED, borderRadius: "4px", marginBottom: "26px" } } },
        ...cardLines(spec),
      ],
    },
  };
}

// Parse the /api/og.png query into a QueryCardSpec (doc is served by
// /api/og/<id>.png, not this route — see QueryCardSpec above). Unknown/missing
// kind → the default wordmark card; this is the HTTP boundary, so a malformed
// external request degrading gracefully is correct here.
export function cardFromQuery(params: URLSearchParams): QueryCardSpec {
  switch (params.get("kind")) {
    case "radar":
      return { kind: "radar" };
    case "radar-actor":
      return { kind: "radarActor", agent: params.get("name") ?? "" };
    case "reports":
      return { kind: "reports" };
    case "report":
      return { kind: "report", name: params.get("name") ?? "" };
    case "connect":
      return { kind: "connect" };
    case "preview":
      return { kind: "preview", label: params.get("label") ?? "" };
    default:
      return { kind: "default" };
  }
}

// Render a card PNG, or null if the toolchain is unavailable.
export async function renderCard(spec: CardSpec): Promise<Buffer | null> {
  try {
    const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
    const svg = await satori(cardNode(spec) as never, { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
  } catch (err) {
    console.error("og-image render failed:", err);
    return null;
  }
}

// LRU memo cache (~40 KB each → ~40 MB at cap), shared across all card kinds.
// Sized above a typical atlas doc count so a crawler walking every card URL
// doesn't thrash it; on a hit the entry is re-inserted so eviction is true LRU
// (Map iteration order = insertion order), not FIFO.
const cache = new Map<string, Buffer>();
const CACHE_MAX = 2048;

async function cached(key: string, render: () => Promise<Buffer | null>): Promise<Buffer | null> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // move to most-recently-used (end of iteration order)
    cache.set(key, hit);
    return hit;
  }
  const png = await render();
  if (png) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, png);
  }
  return png;
}

// Test seam: the cache is module-level, so tests that assert on memoization
// (identical Buffer instance in, identical instance out) would otherwise depend
// on whatever earlier tests left behind. Never called by the server.
export function __resetOgCache(): void {
  cache.clear();
}

// Doc card key = UUID prefix + doc number + title (+ preview label), so a doc
// keeps a stable identity but a title/number/preview edit (UUID unchanged)
// yields a fresh card rather than serving the stale one.
export function ogCacheKey(id: string, title: string, docNo = "", preview = ""): string {
  return `${id.slice(0, 10)}|${docNo}|${preview}|${title}`;
}

export function getOgImage(id: string, title: string, docNo = "", preview = ""): Promise<Buffer | null> {
  const spec: CardSpec = { kind: "doc", docNo, title, ...(preview ? { preview } : {}) };
  return cached(ogCacheKey(id, title, docNo, preview), () => renderCard(spec));
}

// Non-doc cards are pure functions of their spec, so the serialized spec is the
// cache key.
export function getCardImage(spec: CardSpec): Promise<Buffer | null> {
  return cached(`spec:${JSON.stringify(spec)}`, () => renderCard(spec));
}
