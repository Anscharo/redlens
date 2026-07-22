// Dynamic Open Graph card image for atlas documents.
//
// Renders a 1200×630 PNG — a red accent rule, the document title, then
// "Sky Atlas by Redline" — in the app's own palette (src/index.css tokens). satori lays
// the text out into an SVG (with the bundled Inter fonts), resvg rasterizes it
// to PNG. Both run fine under Bun. Results are memoized per (title, doc_no):
// the image is a pure function of those, so the same doc never re-renders.
//
// satori + resvg are imported lazily so the static hot path and boot don't pay
// for them, and a missing native binary degrades to a null return (the route
// then serves a static fallback) instead of crashing the server.

import { readFileSync } from "node:fs";

const WIDTH = 1200;
const HEIGHT = 630;
const TITLE_MAX = 90; // hard cap so pathological titles can't overflow the card

// Palette (kept in sync with src/index.css).
const BG = "#160e0d";
const TAN = "#f3e7ce";
const TAN_3 = "#b8a48e";
const RED = "#a63228";

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

// A leading/trailing plain space between satori spans gets collapsed, so the
// footer words are joined with non-breaking spaces to preserve the gaps.
function footer() {
  const span = (children: unknown, style: Record<string, unknown> = {}) => ({ type: "span", props: { style, children } });
  return {
    type: "div",
    props: {
      style: { display: "flex", fontSize: 34, fontWeight: 400, color: TAN_3 },
      children: [
        span("Sky Atlas", { color: TAN, fontWeight: 600 }),
        span(" by "),
        span("Redline", { color: RED, fontWeight: 600 }),
      ],
    },
  };
}

function cardNode(title: string) {
  const shown = truncateTitle(title);
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
        // Small red accent rule above the title — echoes the reader's red bar.
        { type: "div", props: { style: { width: "72px", height: "8px", backgroundColor: RED, borderRadius: "4px", marginBottom: "30px" } } },
        { type: "div", props: { style: { display: "flex", fontSize: titleFontSize(shown.length), fontWeight: 700, color: TAN, lineHeight: 1.13, marginBottom: "26px" }, children: shown } },
        footer(),
      ],
    },
  };
}

// Render the PNG for a document card, or null if the toolchain is unavailable.
export async function renderOgImage(title: string): Promise<Buffer | null> {
  try {
    const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
    const svg = await satori(cardNode(title) as never, { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
  } catch (err) {
    console.error("og-image render failed:", err);
    return null;
  }
}

// Small memo cache: images are pure functions of the title, ~40 KB each.
const cache = new Map<string, Buffer>();
const CACHE_MAX = 256;

export async function getOgImage(title: string): Promise<Buffer | null> {
  const key = truncateTitle(title);
  const hit = cache.get(key);
  if (hit) return hit;
  const png = await renderOgImage(title);
  if (png) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, png);
  }
  return png;
}
