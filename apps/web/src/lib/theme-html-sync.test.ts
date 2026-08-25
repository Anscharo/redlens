// No `// @vitest-environment jsdom` pragma — this test never touches the DOM.
// `import { THEMES, DEFAULT_THEME } from "./theme"` is safe here even in
// plain Node (no `window`/`localStorage`): theme.ts's module-level
// `let snapshot = read()` call wraps its `localStorage.getItem` in try/catch,
// so the ReferenceError is swallowed and DEFAULT_THEME comes back —
// theme-contrast.test.ts does the identical import with no jsdom pragma and
// passes in the same full-suite run. Importing the real registry (rather than
// also regex-parsing theme.ts) means a shape this file's own regex might
// mis-parse — a reordered field, a `bg` built from a constant — still shows
// up: it's live `THEMES`, not a text-scraped copy. apps/web/index.html, by
// contrast, genuinely can't be imported (it runs its inline script before any
// module exists), so it's parsed as text below.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, DEFAULT_THEME } from "./theme";

// Paths are joined from this file's own directory rather than written as
// `new URL("./index.html", import.meta.url)`: Vite statically rewrites that
// exact pattern into an ASSET url, so fileURLToPath() then gets a non-file
// scheme and throws. Resolving the directory first keeps it a real fs path.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = path.join(HERE, "..", "..", "index.html");
const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");

type RegistryEntry = { bg: string; scheme: "dark" | "light" };

const registry = new Map<string, RegistryEntry>(THEMES.map((t) => [t.id, { bg: t.bg, scheme: t.scheme }]));
const defaultId: string = DEFAULT_THEME;

// ── index.html: the inline pre-paint script's `var THEMES = {...}` twin ──
function parseInlineScriptThemes(html: string): Map<string, RegistryEntry> {
  const block = html.match(/var THEMES = \{([\s\S]*?)\};/);
  if (!block) {
    throw new Error(
      "index.html: could not find `var THEMES = {...};` in the pre-paint inline <script> — has it been renamed or restructured?",
    );
  }
  const entries = new Map<string, RegistryEntry>();
  const entryRe = /(?:"([\w-]+)"|([\w-]+))\s*:\s*\{\s*bg:\s*"(#[0-9a-fA-F]{3,8})",\s*scheme:\s*"(dark|light)"\s*\}/g;
  for (const m of block[1].matchAll(entryRe)) {
    const id = m[1] ?? m[2];
    entries.set(id, { bg: m[3], scheme: m[4] as "dark" | "light" });
  }
  if (entries.size === 0) {
    throw new Error("index.html: `var THEMES` block parsed to zero entries — the regex in theme-html-sync.test.ts no longer matches its shape");
  }
  return entries;
}

// ── index.html: the anti-flash <style> block ──────────────────────────────
function parseAntiFlashStyle(html: string): { rootBg: string | null; rules: Map<string, string> } {
  const style = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!style) throw new Error("index.html: could not find the anti-flash <style> block in <head>");
  const body = style[1];
  const rootMatch = body.match(/:root\{--bg:(#[0-9a-fA-F]{3,8})\}/);
  const rules = new Map<string, string>();
  const ruleRe = /html\[data-theme="([\w-]+)"\]\{--bg:(#[0-9a-fA-F]{3,8})\}/g;
  for (const m of body.matchAll(ruleRe)) rules.set(m[1], m[2]);
  return { rootBg: rootMatch?.[1] ?? null, rules };
}

function parseThemeColorMeta(html: string): string | null {
  const m = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{3,8})"/);
  return m?.[1] ?? null;
}

const inlineMap = parseInlineScriptThemes(indexHtml);
const { rootBg, rules: antiFlashRules } = parseAntiFlashStyle(indexHtml);
const metaColor = parseThemeColorMeta(indexHtml);

describe("index.html theme sync", () => {
  it("declares every registry theme in the inline <script> THEMES map, with matching bg + scheme", () => {
    for (const [id, entry] of registry) {
      const inline = inlineMap.get(id);
      expect(
        inline,
        `"${id}" is in src/lib/theme.ts THEMES but missing from index.html's inline <script> \`var THEMES\` map — add \`${id}: { bg: "${entry.bg}", scheme: "${entry.scheme}" }\` there.`,
      ).toBeDefined();
      expect(
        inline!.bg,
        `"${id}" bg disagrees: src/lib/theme.ts has "${entry.bg}", index.html's inline <script> THEMES map has "${inline!.bg}" — make them match.`,
      ).toBe(entry.bg);
      expect(
        inline!.scheme,
        `"${id}" scheme disagrees: src/lib/theme.ts has "${entry.scheme}", index.html's inline <script> THEMES map has "${inline!.scheme}" — make them match.`,
      ).toBe(entry.scheme);
    }
  });

  it("has no ids in the inline <script> THEMES map that aren't in the registry", () => {
    for (const id of inlineMap.keys()) {
      expect(
        registry.has(id),
        `index.html's inline <script> \`var THEMES\` map declares "${id}", which is not in src/lib/theme.ts THEMES — remove it from index.html, or add "${id}" to the registry if it's meant to exist.`,
      ).toBe(true);
    }
  });

  it("has an anti-flash html[data-theme] rule for every non-default theme, with matching bg", () => {
    for (const [id, entry] of registry) {
      if (id === defaultId) continue;
      const ruleBg = antiFlashRules.get(id);
      expect(
        ruleBg,
        `"${id}" is a non-default theme in src/lib/theme.ts THEMES but has no \`html[data-theme="${id}"]{--bg:...}\` rule in index.html's anti-flash <style> block — add \`html[data-theme="${id}"]{--bg:${entry.bg}}\`.`,
      ).toBeDefined();
      expect(
        ruleBg,
        `"${id}" anti-flash rule bg disagrees: src/lib/theme.ts has "${entry.bg}", index.html's \`html[data-theme="${id}"]\` rule has "${ruleBg}" — make them match.`,
      ).toBe(entry.bg);
    }
  });

  it("has no anti-flash html[data-theme] rule for an id that isn't in the registry", () => {
    for (const id of antiFlashRules.keys()) {
      expect(
        registry.has(id),
        `index.html's anti-flash <style> block has a rule for "${id}", which is not in src/lib/theme.ts THEMES — remove \`html[data-theme="${id}"]{...}\`, or add "${id}" to the registry.`,
      ).toBe(true);
    }
  });

  it("matches the default theme's bg on the bare :root anti-flash rule and the static theme-color meta", () => {
    const def = registry.get(defaultId);
    expect(def, `DEFAULT_THEME ("${defaultId}") in src/lib/theme.ts is not itself a THEMES entry — that's a theme.ts bug, not an index.html one.`).toBeDefined();

    expect(
      rootBg,
      `index.html's anti-flash <style> block has no bare \`:root{--bg:...}\` rule — add \`:root{--bg:${def!.bg}}\` matching the default theme ("${defaultId}").`,
    ).toBeDefined();
    expect(
      rootBg,
      `default theme ("${defaultId}") bg disagrees: src/lib/theme.ts has "${def!.bg}", index.html's bare \`:root\` rule has "${rootBg}" — make them match.`,
    ).toBe(def!.bg);

    expect(
      metaColor,
      `index.html has no static <meta name="theme-color" content="..."> tag to check against the default theme ("${defaultId}").`,
    ).toBeDefined();
    expect(
      metaColor,
      `default theme ("${defaultId}") bg disagrees: src/lib/theme.ts has "${def!.bg}", index.html's static <meta name="theme-color"> has "${metaColor}" — make them match.`,
    ).toBe(def!.bg);
  });
});
