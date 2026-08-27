// index.css defines the color tokens once per theme, as CSS custom
// properties on a handful of root-level blocks (:root plus one
// [data-theme="…"] per candidate). AUDIT_PAIRS enumerates the token PAIRS
// that must stay readable; this file is what turns that enumeration into an
// enforced guarantee — for every theme block, resolve every audited token to
// a literal color and run it through contrastRatio() (the same function
// admin/ContrastAudit.tsx uses), so "we shipped a light theme" can't quietly
// mean "we shipped one nobody can read."
//
// Theme blocks are discovered from the file, never hardcoded, so adding or
// removing a palette needs no edit here. Test D closes the loop in the other
// direction: every theme the app OFFERS must have a block in this file.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio, AUDIT_PAIRS } from "./contrast";
// Aliased: `THEMES` below is this file's map of PARSED CSS blocks.
import { THEMES as APP_THEMES, DEFAULT_THEME } from "../lib/theme";

const CSS_PATH = fileURLToPath(new URL("../index.css", import.meta.url));
const CSS = readFileSync(CSS_PATH, "utf-8");

// ─── CSS parsing helpers ────────────────────────────────────────────────
// Deliberately dumb and narrowly scoped — we only need the custom-property
// declarations out of a handful of root-level blocks, not general CSS
// parsing. Three known traps (see the task/PR description) get handled
// explicitly rather than by accident:
//   1. `color-scheme: dark;` inside a theme block — excluded because the
//      declaration regex only matches names starting with `--`.
//   2. Comments containing `#` hex values (e.g. "darkened 6%") — stripped
//      before any regex runs, so they can never be mistaken for a value.
//   3. `color-mix()` values — captured whole via "everything up to the next
//      semicolon", which also tolerates a value wrapping across lines.

/** Strip all CSS comments before any other scan runs. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Return the body between the `{` at `openIdx` and its matching `}`,
 * counting brace depth rather than assuming the first `}` is the close —
 * none of the blocks we read nest braces, but a scan that assumed that
 * would fail silently (wrong body) instead of loudly if it ever changed. */
function readBlockBody(css: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(openIdx + 1, i);
    }
  }
  throw new Error(`unterminated CSS block starting at index ${openIdx} in ${CSS_PATH}`);
}

/**
 * Discover every "bare" theme root block — a line that is exactly `:root {`
 * or `[data-theme="x"] {` with nothing else in the selector — and parse its
 * `--token: value;` declarations into a flat map. This deliberately excludes
 * the later compound selectors that also mention `[data-theme="light"]`
 * (e.g. `[data-theme="light"] .breadcrumb-link:hover`, or the multi-selector
 * font-smoothing/opacity override blocks): those style specific elements,
 * they don't define the theme's token set, and none of them declare `--`
 * custom properties anyway. Anchoring on "selector alone on its line,
 * immediately followed by `{`" is what tells the two apart.
 */
function parseThemeBlocks(css: string): Record<string, Record<string, string>> {
  const clean = stripComments(css);
  const themes: Record<string, Record<string, string>> = {};
  const selectorRe = /^[ \t]*(?::root|\[data-theme="([^"]+)"\])[ \t]*\{/gm;
  const declRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;

  let match: RegExpExecArray | null;
  while ((match = selectorRe.exec(clean))) {
    const themeName = match[1] ?? "root"; // ":root" itself → "root"
    const openIdx = match.index + match[0].length - 1; // index of the "{"
    const body = readBlockBody(clean, openIdx);
    const tokens = (themes[themeName] ??= {});
    declRe.lastIndex = 0;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(body))) {
      tokens[decl[1]] = decl[2].trim();
    }
  }
  return themes;
}

const THEMES = parseThemeBlocks(CSS);
const THEME_NAMES = Object.keys(THEMES); // discovered, never hardcoded
const LIGHT_THEME_NAMES = THEME_NAMES.filter((name) => name !== "root");

// Sanity check on the parser itself: if this is empty or singular, every
// test below would vacuously pass (nothing to iterate), silently destroying
// the guarantee. Fail loudly instead.
if (THEME_NAMES.length < 2) {
  throw new Error(
    `theme-contrast.test.ts found only ${THEME_NAMES.length} theme block(s) (${THEME_NAMES.join(", ")}) in ${CSS_PATH} — expected :root plus at least one [data-theme="…"] block. The parser likely regressed.`,
  );
}

describe("theme block discovery", () => {
  it("finds :root plus every bare [data-theme] block, and only those", () => {
    // Locks the parser's behavior in independently of the two content tests
    // below, so a parser regression is diagnosed here instead of showing up
    // as a confusing mass failure/pass in Test A/B/C.
    expect(THEME_NAMES).toContain("root");
    expect(LIGHT_THEME_NAMES.length).toBeGreaterThanOrEqual(1);
    for (const name of LIGHT_THEME_NAMES) {
      expect(CSS).toContain(`[data-theme="${name}"]`);
    }
  });
});

// ─── Test A ─────────────────────────────────────────────────────────────
describe("every AUDIT_PAIRS token resolves to a literal hex color in every theme", () => {
  // contrastRatio() returns null for anything that isn't plain #rrggbb —
  // var(), color-mix(), and rgba() all included. Test B feeds resolved
  // values straight into contrastRatio() and asserts the ratio, so if a
  // theme ever gave an audited token one of those indirections instead of a
  // literal hex, Test B would just get `null` back — which fails loudly
  // there too, but with a "expected >= 4.5, got null" message that doesn't
  // say WHICH token or theme is the indirection. Assert the literal-hex
  // shape here, by name, so that failure is legible.
  const auditedTokens = Array.from(new Set(AUDIT_PAIRS.flatMap((pair) => [pair.fg, pair.bg]))).sort();

  const cases = THEME_NAMES.flatMap((theme) => auditedTokens.map((token) => ({ theme, token })));

  it.each(cases)('[data-theme="$theme"] --$token is a plain #rrggbb hex', ({ theme, token }) => {
    const value = THEMES[theme][token];
    expect(
      value,
      `[data-theme="${theme}"] --${token} = ${JSON.stringify(value)} — not a literal #rrggbb hex (var()/color-mix()/rgba()/missing all fail contrastRatio() silently)`,
    ).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

// ─── Test B ─────────────────────────────────────────────────────────────
// WCAG 1.4.11 (non-text contrast) covers UI-component boundaries/graphics —
// 3:1, not the 4.5:1 that 1.4.3 requires for normal text. Named here as its
// own constant, not a threshold buried in the loop below, so the exemption
// from the normal-text bar is visible and auditable at a glance. Keep this
// in sync with the `label`s added to AUDIT_PAIRS for the same purpose.
const NON_TEXT_PAIR_LABELS = new Set<string>([
  "focus ring / bg", // :focus-visible { outline: 2px solid var(--accent) } — a ring, not text
  "focus ring / surface",
]);

// The ONE accepted exception, named rather than hidden in a lowered threshold.
//
// --red is documented in index.css as decorative-only: it paints the selected
// left bar, pill bars and histogram fills. Red TEXT is meant to go through
// --error-text, which is 4.5:1+ on every surface by construction — that is the
// whole reason the alias exists, and `.text-red` resolves to it. ONE rule
// breaks that: `.filter-summary-em` paints text with --red on the inverted
// --tan fill, which is why both non-default themes have to override it
// (2.77:1 in light, 1.23:1 in giedi). It is not covered by the pair below,
// which measures --red against --surface.
//
// Measured on the dark palette it is 2.61:1 on --surface, 2.82:1 on --bg and
// 2.93:1 on --bg-deep, so it clears neither 4.5:1 nor the 3:1 non-text bar.
// This is PRE-EXISTING and predates the light theme — the pair sat in
// AUDIT_PAIRS as advisory display on /admin/palette for a long time; promoting
// that list to a hard gate is what surfaced it. Raising it means moving the
// brand red, which is a design decision for the owner, not a silent edit made
// while shipping a light theme. It is reported as a finding instead.
//
// Both light palettes clear this pair (6.8:1), so the exception is dark-only:
// if a light theme ever regresses here the gate still fails.
const ACCEPTED_DECORATIVE_FAILURES = new Map<string, string>([
  ["root::red (decorative) / surface", "brand red, decorative-only; 2.61:1 — see comment above"],
]);

describe("every AUDIT_PAIRS entry meets its WCAG threshold in every theme", () => {
  const cases = THEME_NAMES.flatMap((theme) =>
    AUDIT_PAIRS.map((pair) => ({
      theme,
      label: pair.label,
      fgToken: pair.fg,
      bgToken: pair.bg,
      threshold: NON_TEXT_PAIR_LABELS.has(pair.label) ? 3.0 : 4.5,
    })),
  );

  it.each(cases)('[data-theme="$theme"] $label >= $threshold:1', ({ theme, label, fgToken, bgToken, threshold }) => {
    const fg = THEMES[theme][fgToken];
    const bg = THEMES[theme][bgToken];
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `[data-theme="${theme}"] "${label}" (--${fgToken} ${JSON.stringify(fg)} on --${bgToken} ${JSON.stringify(bg)}) resolved to a null ratio — one of the two values isn't a plain #rrggbb hex`,
    ).not.toBeNull();

    // A named exception still asserts — it just asserts the RECORDED failure,
    // so the pair can never quietly get worse and can never be forgotten: the
    // day someone fixes it, this flips red and the entry gets deleted.
    const accepted = ACCEPTED_DECORATIVE_FAILURES.get(`${theme}::${label}`);
    if (accepted) {
      expect(
        ratio as number,
        `[data-theme="${theme}"] "${label}" is an accepted exception (${accepted}) but now measures ${ratio}:1. If it improved past ${threshold}:1, delete its ACCEPTED_DECORATIVE_FAILURES entry; if it got worse, that's a regression.`,
      ).toBeLessThan(threshold);
      return;
    }

    expect(
      ratio as number,
      `[data-theme="${theme}"] "${label}" (--${fgToken} on --${bgToken}) = ${ratio}:1, need >= ${threshold}:1`,
    ).toBeGreaterThanOrEqual(threshold);
  });

  it("every ACCEPTED_DECORATIVE_FAILURES entry names a pair that still exists", () => {
    const known = new Set(cases.map((c) => `${c.theme}::${c.label}`));
    for (const key of ACCEPTED_DECORATIVE_FAILURES.keys()) {
      expect(known, `ACCEPTED_DECORATIVE_FAILURES lists ${key}, which is no longer an audited theme/pair — remove it`).toContain(key);
    }
  });
});

// ─── Test C ─────────────────────────────────────────────────────────────
// Non-color tokens that legitimately have no light-theme value: layout/timing
// constants, not colors, so there's nothing for a theme to override. Every
// other token in :root is a color and MUST be redefined in every
// [data-theme="…"] block — anything added to :root and left off this list
// (without also being added to every theme block) silently inherits the
// dark value forever: nothing else forces a light value to exist, and the
// omission is invisible until a user in light mode hits that one token still
// rendering dark-on-light.
const THEME_NEUTRAL = new Set<string>([
  "row-pulse-ms", // duration (700ms), not a color
  "change-flash-ms", // duration (600ms), kept in sync with useRevealFlash.ts
  "max-prose-width", // layout constant (90ch), not a color
]);

describe("every :root color token is redefined in every light theme", () => {
  const rootTokens = Object.keys(THEMES.root);
  const auditedRootTokens = rootTokens.filter((token) => !THEME_NEUTRAL.has(token));

  const cases = LIGHT_THEME_NAMES.flatMap((theme) => auditedRootTokens.map((token) => ({ theme, token })));

  it.each(cases)('[data-theme="$theme"] defines --$token (present in :root)', ({ theme, token }) => {
    expect(
      THEMES[theme][token],
      `[data-theme="${theme}"] is missing --${token} (defined in :root as ${JSON.stringify(THEMES.root[token])}) — it will silently render with the dark value. Either give it a light-theme value, or add it to THEME_NEUTRAL in theme-contrast.test.ts with a reason if it's genuinely not a color.`,
    ).toBeDefined();
  });

  it("THEME_NEUTRAL contains only tokens that are actually absent from every light theme", () => {
    // Guards the allowlist from the other direction: a token that no longer
    // needs the exemption (someone gave it a light value later) should come
    // off the list, or it stops meaning anything.
    for (const token of THEME_NEUTRAL) {
      const stillMissingSomewhere = LIGHT_THEME_NAMES.some((theme) => THEMES[theme][token] === undefined);
      expect(
        stillMissingSomewhere,
        `THEME_NEUTRAL lists --${token}, but it's now defined in every light theme — remove it from the allowlist so it goes back to being checked`,
      ).toBe(true);
    }
  });
});

// ─── Test D ─────────────────────────────────────────────────────────────
// The other half of the completeness guarantee. Tests A-C all start from the
// CSS: they check that whatever blocks exist are complete and readable. That
// says nothing about a theme listed in lib/theme.ts's THEMES registry with NO
// block in index.css — the picker would offer it, `data-theme` would be set,
// every token would fall through to :root, and the user would silently get the
// dark palette under a light-sounding name. Nothing else catches that, because
// CSS has no such thing as an unresolved selector.
describe("every theme the app offers has a token block in index.css", () => {
  const cssThemes = new Set(THEME_NAMES);

  it.each(APP_THEMES.map((t) => t.id))('THEMES id "%s" has a block in index.css', (id) => {
    const expected = id === DEFAULT_THEME ? "root" : id;
    expect(
      cssThemes,
      `lib/theme.ts offers the theme "${id}" but index.css has no ${
        id === DEFAULT_THEME ? ":root" : `[data-theme="${id}"]`
      } token block — the picker would show it and every token would silently fall through to the dark :root values. Add the block (a FULL override of every :root color token), or remove the registry entry.`,
    ).toContain(expected);
  });

  it("index.css defines no theme block the app can't select", () => {
    const offered = new Set<string>(APP_THEMES.map((t) => (t.id === DEFAULT_THEME ? "root" : t.id)));
    for (const name of THEME_NAMES) {
      expect(
        offered,
        `index.css defines a [data-theme="${name}"] block, but no THEMES entry in lib/theme.ts selects it — it is dead CSS that the picker can never reach. Add a registry entry or delete the block.`,
      ).toContain(name);
    }
  });
});

// Perceptual distance in OKLab, where Euclidean distance is roughly uniform.
// ~0.020 is one JND: below it, two colours are not reliably tellable apart.
// Used by the depth-ramp and entity-palette gates below, both of which ask
// "do these look the same?" — a question no contrast ratio can answer.
const JND = 0.02;
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s2 = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2,
  ];
}
function perceptualDistance(a: string, b: string): number {
  const [x, y, z] = oklab(a);
  const [p, q, r] = oklab(b);
  return Math.hypot(x - p, y - q, z - r);
}

// ─── Test E ─────────────────────────────────────────────────────────────
// The depth ramp's SHAPE, which contrast alone can't see. Every stop already
// has to clear AA (Test B covers depth-1…6); this checks the property those
// ratios say nothing about — how the ramp moves from one stop to the next.
//
// It exists because the seam is invisible to a per-token check and easy to
// reintroduce. The colour themes run a 6- or 7-stop hue cycle that restarts at
// the top, which is fine when hue carries the identity. giedi has no hue, so a
// restart is a hard bright jump in the middle of a descending tree; it was
// caught by eye once and is asserted here so it can't come back silently.
describe("giedi's depth ramp is one continuous curve, not a cycle", () => {
  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const stops = Array.from({ length: 17 }, (_, i) => THEMES.giedi[`depth-${i + 1}`]);

  it("has no seam — every step is small and no stop repeats a distant one", () => {
    // Measured, not guessed: one rung of the triangle is 0.026 OKLCH L, which
    // is at most 0.062 of RELATIVE luminance (the two are not proportional —
    // the same rung is a bigger luminance step at the light end). A cycle
    // restart crosses the whole range at once: 0.376. The bound sits between
    // them with room for the ramp to be retuned without tripping it.
    for (let i = 1; i < stops.length; i++) {
      const step = Math.abs(lum(stops[i]) - lum(stops[i - 1]));
      expect(
        step,
        `--depth-${i + 1} (${stops[i]}) jumps ${step.toFixed(3)} in relative luminance from --depth-${i} (${stops[i - 1]}). giedi's ramp is meant to be continuous: light to dark and symmetrically back, with no restart. See the depth-palette note in the giedi block.`,
      ).toBeLessThan(0.12);
    }
  });

  // This gate has been RELAXED once, deliberately, and the reason matters.
  //
  // It first held ADJACENT stops above the JND, written after a human reported
  // that the tree "looks like one solid colour". But adjacent-pair separation
  // was never quite the invariant that bug was about: the ramp had collapsed
  // END TO END, not just locally. The current ramp is intentionally subtle
  // step to step (adjacent stops measure 0.012, under the JND) and legible
  // over distance instead — so holding the adjacent figure would forbid a
  // design choice rather than catch a defect.
  //
  // What is asserted instead is what the ramp actually promises: two levels
  // apart are tellable apart, and the ends are unmistakably different. Those
  // two together still fail a ramp that has gone flat, which is the failure
  // this exists to catch.
  it("stays legible over distance, even where adjacent steps are subtle", () => {
    for (let i = 2; i < 9; i++) {
      const d = perceptualDistance(stops[i], stops[i - 2]);
      expect(
        d,
        `--depth-${i + 1} (${stops[i]}) and --depth-${i - 1} (${stops[i - 2]}) are ${d.toFixed(4)} apart in OKLab, under the ~${JND} JND. Adjacent stops on this ramp are allowed to be subtle, but two apart must read — below that the tree collapses into one colour. See the depth-palette note in the giedi block.`,
      ).toBeGreaterThanOrEqual(JND);
    }
    const ends = perceptualDistance(stops[0], stops[8]);
    expect(
      ends,
      `--depth-1 (${stops[0]}) and --depth-9 (${stops[8]}) are only ${ends.toFixed(3)} apart — the ramp has no travel left in it, so nesting conveys nothing.`,
    ).toBeGreaterThanOrEqual(0.06);
  });

  // The old test here asserted the OPPOSITE — that every stop held one hue,
  // because lightness was the depth signal and a drifting hue would have
  // competed with it. The ramp has since been inverted: hue is the signal now
  // and lightness is held flat, so hue constancy would be a bug. What replaces
  // it are the invariants that version actually depends on.
  it("holds lightness flat, so depth costs no contrast", () => {
    const ratios = stops.map((hex) => contrastRatio(hex, THEMES.giedi.surface) as number);
    const spread = Math.max(...ratios) - Math.min(...ratios);
    expect(
      Math.min(...ratios),
      `the dimmest depth stop is ${Math.min(...ratios).toFixed(2)}:1 on --surface. Depth is carried by hue here precisely so that deep rows are not dimmer than shallow ones.`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      spread,
      `depth contrast ranges over ${spread.toFixed(2)} on --surface — this ramp is meant to hold lightness FLAT and vary hue. If you are reintroducing a brightness ramp, rewrite the depth-palette note in the giedi block first.`,
    ).toBeLessThan(2);
  });

  it("stays muted, and travels warm to cool", () => {
    const chroma = (hex: string) => {
      const [, a, b] = oklab(hex);
      return Math.hypot(a, b);
    };
    // The ends carry the colour; the middle is meant to be nearly neutral.
    expect(
      Math.max(...stops.map(chroma)),
      "a depth stop exceeds the muted ceiling — the ramp's endpoints are meant to read as tinted greys, not as colours.",
    ).toBeLessThan(0.07);
    expect(
      chroma(stops[4]),
      `--depth-5 (${stops[4]}) should sit near the neutral axis: the ramp interpolates through it, which is what keeps mid-depths subtle.`,
    ).toBeLessThan(0.015);
    // b (the blue-yellow axis) must fall monotonically from warm to cool.
    const warmth = stops.slice(0, 9).map((hex) => oklab(hex)[2]);
    for (let i = 1; i < warmth.length; i++)
      expect(
        warmth[i],
        `--depth-${i + 1} is not cooler than --depth-${i} — the ramp must run yellowish to blue in one direction, with no reversal before the trough.`,
      ).toBeLessThan(warmth[i - 1]);
    expect(warmth[0], "--depth-1 should be on the warm side of neutral").toBeGreaterThan(0);
    expect(warmth[8], "--depth-9 should be on the cool side of neutral").toBeLessThan(0);
  });

  it("starts off-white, leaving the selected-doc title somewhere brighter to go", () => {
    // .atlas-node.is-selected .atlas-node-title resolves to --selected-title
    // under [data-theme="giedi"] (index.css). An unselected top-level title
    // takes --depth-1; if the two converged, selecting a doc would change
    // nothing visible. Measured against the title token rather than --accent
    // on purpose: the title is deliberately NOT pure white (halation), so
    // --accent is not the ceiling this has to stay under.
    expect(
      lum(stops[0]),
      `--depth-1 is ${stops[0]}, at or above --selected-title (${THEMES.giedi["selected-title"]}) — a selected top-level title would be indistinguishable from an unselected one.`,
    ).toBeLessThan(lum(THEMES.giedi["selected-title"]) - 0.05);
  });
});

// ─── Test F ─────────────────────────────────────────────────────────────
// Diff blocks have to be visible AS BLOCKS. AUDIT_PAIRS checks each diff
// foreground against its own fill, which says only that the text is readable
// once you have found it — nothing there notices a --diff-added-bg that has
// faded into the --surface the diff box is painted with (DiffView.tsx's
// DIFF_BOX_BG), or an added and a removed block that have converged on each
// other. Both regressions have reached a human by eye already.
//
// Deliberately NOT a WCAG ratio: WCAG is luminance-only, and the light theme's
// blocks separate almost entirely by HUE (#fee2e2 against #ffffff is 1.09:1
// and perfectly legible). Plain Euclidean distance in sRGB is crude — it is
// not perceptually uniform — but it counts hue and lightness both, which is
// what this tripwire needs. The bound is set well under every shipping theme's
// real margin (measured: 41-69 against surface, 43-86 between the pair), so it
// fires on a block that has genuinely collapsed, not on a retune.
describe("diff blocks are visibly distinct in every theme", () => {
  const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dist = (a: string, b: string): number =>
    Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  const MIN = 25;

  it.each(THEME_NAMES.flatMap((theme) => [
    { theme, label: "added block vs the diff box", a: "diff-added-bg", b: "surface" },
    { theme, label: "removed block vs the diff box", a: "diff-removed-bg", b: "surface" },
    { theme, label: "added block vs removed block", a: "diff-added-bg", b: "diff-removed-bg" },
  ]))('[data-theme="$theme"] $label', ({ theme, label, a, b }) => {
    const d = dist(THEMES[theme][a], THEMES[theme][b]);
    expect(
      d,
      `[data-theme="${theme}"] ${label}: --${a} (${THEMES[theme][a]}) and --${b} (${THEMES[theme][b]}) are ${d.toFixed(0)} apart in sRGB, under ${MIN}. The block will not read as a block — give it more lightness separation, more hue, or both.`,
    ).toBeGreaterThan(MIN);
  });
});

// ─── Test G ─────────────────────────────────────────────────────────────
// giedi's two off-registry colours. Both sit outside everything above:
// --selected-hint is declared only in the giedi block (so Test C, which walks
// :root, never sees it) and .filter-summary-em's value is a literal in a rule
// (so no token test can reach it at all). They are the two easiest values in
// the file to break silently, which is exactly why they are asserted here.
describe("giedi's off-registry colours stay readable", () => {

  // The selected doc is a black block, but its type pill is painted on
  // --surface — so the hint has to clear both, not just the darker one.
  it("--selected-title stays the brightest text on the selected doc, without going pure white", () => {
    const title = THEMES.giedi["selected-title"];
    expect(contrastRatio(title, THEMES.giedi["atlas-row-selected"]) as number).toBeGreaterThanOrEqual(4.5);
    // Brighter than body text, but short of --accent: pure white on the black
    // fill is 21:1, which is halation territory rather than extra legibility.
    expect(
      contrastRatio(title, THEMES.giedi["atlas-row-selected"]) as number,
      `--selected-title (${title}) is not brighter than --tan (${THEMES.giedi.tan}) on the selected doc's fill`,
    ).toBeGreaterThan(contrastRatio(THEMES.giedi.tan, THEMES.giedi["atlas-row-selected"]) as number);
    expect(
      title.toLowerCase(),
      "--selected-title is pure white — see the halation note on the token",
    ).not.toBe("#ffffff");
  });

  // giedi replaces depth-coloured titles with one flat colour, which only
  // works if it lands cleanly between body prose and a selected title — too
  // close to --tan and titles stop reading as titles, too close to
  // --selected-title and selecting one stops reading as selection. Three
  // tokens, two gaps, both of which have to clear the JND; nothing else in
  // this file checks a token against another FOREGROUND.
  it("--node-title sits between body prose and a selected title", () => {
    const { tan, "node-title": title, "selected-title": selected } = THEMES.giedi;
    expect(
      perceptualDistance(title, tan),
      `--node-title (${title}) is within a JND of --tan (${tan}) — doc titles would be indistinguishable from body prose.`,
    ).toBeGreaterThanOrEqual(JND);
    expect(
      perceptualDistance(title, selected),
      `--node-title (${title}) is within a JND of --selected-title (${selected}) — selecting a doc would not visibly change its title.`,
    ).toBeGreaterThanOrEqual(JND);
    // And it has to out-read prose on the surface titles actually sit on.
    expect(contrastRatio(title, THEMES.giedi["bg-deep"]) as number).toBeGreaterThanOrEqual(4.5);
  });

  it("--node-hover is a noticeable lift off the reader, not another grey", () => {
    const hover = THEMES.giedi["node-hover"];
    const deep = THEMES.giedi["bg-deep"];
    expect(
      perceptualDistance(hover, deep),
      `--node-hover (${hover}) is within a JND of --bg-deep (${deep}) — the reader hover would still be invisible. The previous mix of --bg-deep toward --surface measured 0.009.`,
    ).toBeGreaterThanOrEqual(0.05);
    expect(contrastRatio(THEMES.giedi["node-title-hover"], hover) as number).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(THEMES.giedi["node-title"], hover) as number).toBeGreaterThanOrEqual(4.5);
  });

  it("--node-title-hover is a gold tint of the resting title, not a new colour", () => {
    const rest = THEMES.giedi["node-title"];
    const hover = THEMES.giedi["node-title-hover"];
    const hint = THEMES.giedi["selected-hint"];
    expect(
      perceptualDistance(hover, rest),
      `--node-title-hover (${hover}) is within a JND of --node-title (${rest}) — hovering a reader row would not recolour the title.`,
    ).toBeGreaterThanOrEqual(JND);
    expect(
      perceptualDistance(hover, hint),
      `--node-title-hover (${hover}) is closer to --selected-hint (${hint}) than the resting title is — it should stay in the gold family.`,
    ).toBeLessThan(perceptualDistance(rest, hint));
  });

  it.each([
    { on: "atlas-row-selected", why: "the selected doc's fill" },
    { on: "surface", why: "the type pill's own fill" },
    { on: "bg", why: "the Connect page, where tool names use the hint" },
  ])("--selected-hint is readable on --$on ($why)", ({ on }) => {
    const ratio = contrastRatio(THEMES.giedi["selected-hint"], THEMES.giedi[on]);
    expect(ratio, `--selected-hint (${THEMES.giedi["selected-hint"]}) is missing or not a plain hex`).not.toBeNull();
    expect(ratio as number).toBeGreaterThanOrEqual(4.5);
  });

  // .q-mark is the only highlight in the theme that does NOT set its own text
  // colour (`color: inherit`), so it has to stay readable under the DIMMEST
  // text a report row can carry, not just under --tan. It is also a
  // color-mix() against transparent, which no token test can see — the value
  // that actually reaches the screen only exists once it composites over the
  // row beneath it, so the composite is what gets asserted.
  it.each(["bg", "surface"])("the report-search highlight stays readable over --%s", (under) => {
    // Parsed from the rule, NOT hardcoded: a constant here would keep passing
    // if someone made .q-mark solid, which is exactly the change that breaks it.
    const rule = CSS.match(/\[data-theme="giedi"\]\s+\.q-mark\s*\{([^}]*)\}/);
    expect(rule, 'no `[data-theme="giedi"] .q-mark` rule found in index.css').not.toBeNull();
    const pct = rule![1].match(/var\(--red-dim\)\s+(\d+(?:\.\d+)?)%/);
    expect(
      pct,
      `[data-theme="giedi"] .q-mark must blend --red-dim with a percentage — a SOLID fill puts --tan-3 at 3.2:1, and .q-mark inherits its text colour. Found: ${rule![1].trim()}`,
    ).not.toBeNull();
    const ALPHA = Number(pct![1]) / 100;
    const mix = (fg: string, bg: string): string => {
      const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
      return (
        "#" +
        [0, 1, 2]
          .map((i) => Math.round(ch(fg, i) * ALPHA + ch(bg, i) * (1 - ALPHA)).toString(16).padStart(2, "0"))
          .join("")
      );
    };
    const fill = mix(THEMES.giedi["red-dim"], THEMES.giedi[under]);
    expect(
      contrastRatio(THEMES.giedi["tan-3"], fill) as number,
      `--tan-3 (${THEMES.giedi["tan-3"]}) on the .q-mark fill composited over --${under} (${fill}) is below AA. .q-mark inherits its text colour, so a solid --red-dim fill is NOT safe here — that measures 3.2:1.`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  // .filter-summary is INVERTED by default (a --tan fill, --bg text), which is
  // why it needs its own assertion: its emphasis is measured against a TEXT
  // token, not a background, and nothing in AUDIT_PAIRS is shaped like that.
  // giedi opts out of the inversion (a near-white slab on a near-black page is
  // glaring, and the inherited --red emphasis measured 1.23:1 on it), so here
  // the pair is the emphasis against --surface. Both halves are asserted, so
  // re-inverting the callout without re-checking the emphasis fails.
  it("[data-theme=giedi] .filter-summary is legible, emphasis included", () => {
    const rule = CSS.match(/\[data-theme="giedi"\]\s+\.filter-summary\s*\{([^}]*)\}/);
    expect(rule, 'no `[data-theme="giedi"] .filter-summary` rule found in index.css').not.toBeNull();
    const fill = rule![1].match(/background:\s*var\(--([\w-]+)\)/);
    expect(
      fill,
      `giedi's .filter-summary must set its background from a token; found: ${rule![1].trim()}`,
    ).not.toBeNull();
    const bg = THEMES.giedi[fill![1]];

    for (const fg of ["tan", "selected-hint"]) {
      const r = contrastRatio(THEMES.giedi[fg], bg);
      expect(
        r as number,
        `--${fg} (${THEMES.giedi[fg]}) on the giedi .filter-summary fill --${fill![1]} (${bg}) is below AA. This callout is the one place a TEXT token can end up as a background, which is how the inherited --red emphasis reached 1.23:1.`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The CrossView treemap ramps --chunk-fill into --surface at up to 70% and
  // paints a --tan-2 label on the result. Nothing else in this file can see
  // that: both operands pass every contrast pair on their own, and the value
  // that actually reaches the screen only exists after the mix. The ramp's
  // DIRECTION also differs per theme — dark/giedi deepen away from a light
  // label, light lightens away from a dark one — so this is asserted for every
  // theme rather than for giedi alone. Historic failures: light 2.91:1,
  // giedi 1.61:1, both from aiming the ramp at --red.
  it.each(THEME_NAMES)('[data-theme="%s"] treemap labels survive the deepest rect', (theme) => {
    const DEEPEST = 0.7; // must match FILL_BY_DEPTH's fallback in CrossViewTreemap.tsx
    const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    const fill =
      "#" +
      [0, 1, 2]
        .map((i) =>
          Math.round(ch(THEMES[theme]["chunk-fill"], i) * DEEPEST + ch(THEMES[theme].surface, i) * (1 - DEEPEST))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    expect(
      contrastRatio(THEMES[theme]["tan-2"], fill) as number,
      `[data-theme="${theme}"] the deepest treemap rect is ${fill} (--chunk-fill ${THEMES[theme]["chunk-fill"]} at ${DEEPEST * 100}% over --surface ${THEMES[theme].surface}), and its --tan-2 label (${THEMES[theme]["tan-2"]}) is below AA on it. --chunk-fill has to be chosen against the LABEL, not against the brand.`,
    ).toBeGreaterThanOrEqual(4.5);
  });

});

// ─── Test H ─────────────────────────────────────────────────────────────
// The entity palette is 14 UNORDERED categories, so unlike the depth ramp it
// has no fallback signal: if two of them converge there is no "deeper means
// dimmer" to read instead, just two swatches that look the same. Contrast
// can't see this at all — every one of them can clear 4.5:1 on --surface and
// still be mutually indistinguishable, which is precisely what giedi's first
// entity palette did (14 hues at C 0.026, closest pair 0.024, under a JND).
//
// Measured in OKLab, where Euclidean distance is roughly perceptual — the one
// place in this file worth the conversion, because "these two look the same"
// is the actual question and channel spread cannot answer it.
describe("no two entity colours collapse into each other", () => {
  // ~0.02 is roughly one JND. 0.030 is the bar: comfortably above "might be
  // the same swatch", comfortably below what any deliberate palette produces.
  const MIN = 0.03;

  // Recorded, not waived — same arrangement as ACCEPTED_DECORATIVE_FAILURES.
  // The light theme's warm pair sits under the bar and predates giedi; it is
  // asserted at its measured value so it can't quietly get worse, and so the
  // day someone fixes it this flips red and the entry comes out.
  const RECORDED_COLLAPSES = new Map<string, number>([
    ["light", 0.017], // --entity-facilitator-org vs --entity-multisig
  ]);

  it.each(THEME_NAMES)('[data-theme="%s"] keeps every pair apart', (theme) => {
    const names = Object.keys(THEMES[theme]).filter((t) => t.startsWith("entity-"));
    let worst = { d: Infinity, a: "", b: "" };
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const d = perceptualDistance(THEMES[theme][names[i]], THEMES[theme][names[j]]);
        if (d < worst.d) worst = { d, a: names[i], b: names[j] };
      }
    const recorded = RECORDED_COLLAPSES.get(theme);
    const detail = `closest pair is --${worst.a} (${THEMES[theme][worst.a]}) / --${worst.b} (${THEMES[theme][worst.b]}) at ${worst.d.toFixed(3)}`;
    if (recorded !== undefined) {
      expect(
        worst.d,
        `[data-theme="${theme}"] has a RECORDED collapse at ~${recorded}, but ${detail}. If it improved past ${MIN}, delete its RECORDED_COLLAPSES entry; if it got worse, that is a regression.`,
      ).toBeGreaterThanOrEqual(recorded - 0.002);
      expect(worst.d).toBeLessThan(MIN);
      return;
    }
    expect(
      worst.d,
      `[data-theme="${theme}"] ${detail} — under ${MIN}, about one JND, so the two types are not tellable apart. Contrast tests cannot catch this; both can be perfectly readable and still identical.`,
    ).toBeGreaterThanOrEqual(MIN);
  });
});

// ─── Test I ─────────────────────────────────────────────────────────────
// giedi is ADVERTISED as high contrast — "greyscale · high contrast" in the
// THEMES registry, and again in the Features guide and the patch notes. That
// is a measurable claim, and for a while it was not a true one: the theme won
// on chrome (chiclets, links, focus ring) while its BODY PROSE was the
// lowest-contrast of the three themes, which is the opposite of what a reader
// would infer from the label.
//
// Nothing else here would catch that. Every AUDIT_PAIRS entry asks only for
// AA, which giedi cleared comfortably the whole time it was losing to dark on
// the pairs that matter most. So this measures the claim directly, against the
// original palette as the benchmark rather than against a fixed number: the
// point is not "some ratio" but "you are not giving up readable prose to get
// the greyscale".
describe('giedi earns the "high contrast" it advertises', () => {
  const PROSE = ["tan", "tan-2"] as const;
  const SURFACES = ["bg", "surface", "bg-deep"] as const;

  it.each(PROSE.flatMap((fg) => SURFACES.map((bg) => ({ fg, bg }))))(
    "--$fg on --$bg is at least as readable as the dark theme's",
    ({ fg, bg }) => {
      const giedi = contrastRatio(THEMES.giedi[fg], THEMES.giedi[bg]) as number;
      const dark = contrastRatio(THEMES.root[fg], THEMES.root[bg]) as number;
      expect(
        giedi,
        `giedi --${fg} on --${bg} is ${giedi.toFixed(2)}:1 against the dark theme's ${dark.toFixed(2)}:1. giedi is advertised as the high-contrast palette (see the hint on its THEMES entry in lib/theme.ts); it cannot be the one where prose is hardest to read. Darken the surface tier or lift the text ramp — and if you deliberately want to drop this claim, change the copy in lib/theme.ts, featuresData.ts and patch-notes.md in the same commit.`,
      ).toBeGreaterThanOrEqual(dark - 0.05);
    },
  );

  it("leaves no audited pair under 5:1", () => {
    // The claim's other half, and the one giedi has always been good at: a
    // high floor. Deliberately stricter than the 4.5 AA bar every theme meets.
    for (const pair of AUDIT_PAIRS) {
      const r = contrastRatio(THEMES.giedi[pair.fg], THEMES.giedi[pair.bg]);
      if (r === null) continue;
      expect(
        r,
        `giedi "${pair.label}" is ${r.toFixed(2)}:1. It clears AA, but giedi's claim is a high FLOOR — it is the only theme with nothing under 5:1, and that is worth keeping.`,
      ).toBeGreaterThanOrEqual(5);
    }
  });
});
