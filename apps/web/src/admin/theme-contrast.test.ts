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
// left bar, pill bars and histogram fills, never text (red TEXT goes through
// --error-text, which is 4.5:1+ on every surface by construction — that is the
// whole reason the alias exists, and `.text-red` resolves to it).
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
