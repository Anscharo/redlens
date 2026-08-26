// The OTHER half of the theme guarantee.
//
// theme-contrast.test.ts proves every TOKEN is readable in every theme. It can
// say nothing about a colour written directly into a component, because such a
// colour never reaches index.css — and that is precisely how a component goes
// wrong: `color: "#fff"` is invisible to a token audit, looks right in the
// theme it was written for, and disappears in the other one.
//
// This is not hypothetical. When the light themes landed, eleven components
// were found holding literal dark-mode colours — radar's near-black zebra
// table, `#fff` pills sitting on a light hover fill, an inverted preview badge
// hardcoded to `backgroundColor: "white"` / `color: "#160e0d"`, and
// `colorMode="dark"` pinned on ReactFlow. Every one of them passed the token
// audit, and every one of them was unreadable in light mode.
//
// So: components may not name colours. They reference tokens, which the
// contrast test then holds to AA in every theme. Anything that genuinely must
// be absolute is listed in ALLOWED below, with a reason — the list is the
// argument, and it should stay short.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Directories exempt from the scan, with the reason each is exempt. */
const SKIP_DIRS: Record<string, string> = {
  admin: "the palette editor parses and renders colour strings as its subject matter",
  test: "test helpers and stubs, not shipped UI",
};

/**
 * Deliberate absolute colours: `"<repo-relative path>": "<why>"`.
 *
 * Add an entry ONLY for a colour that must not follow the theme. If a colour
 * merely "looks fine in both", that is not a reason — use a token, so the
 * contrast test can keep holding it to AA as the palettes change.
 */
const ALLOWED: Record<string, string> = {
  "components/chat/glyphs.tsx":
    "Google's brand mark in the sign-in button — a logo must render in its own colours, never the theme's",
  "components/Drawer.tsx":
    "bg-black/40 modal scrim — a scrim darkens whatever is behind it, so it is absolute in both themes by definition",
  "lib/theme.ts":
    "the THEMES registry's per-theme --bg, which is the source of truth the CSS and index.html are checked against (theme-html-sync.test.ts)",
};

// Colour-shaped literals. Deliberately narrow: a bare `#256` in prose is an
// issue number, not a colour, so a hex only counts when it is the ENTIRE value
// of a quoted string or a JSX attribute.
const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /['"`]#[0-9a-fA-F]{3,8}['"`]/g, what: "a hex colour literal" },
  { re: /=\s*"#[0-9a-fA-F]{3,8}"/g, what: "a hex colour in a JSX attribute" },
  { re: /\brgba?\(\s*[0-9]/g, what: "an rgb()/rgba() literal" },
  { re: /-\[#[0-9a-fA-F]{3,8}\]/g, what: "a Tailwind arbitrary colour value" },
  // Tailwind's own palette. The repo's token utilities (text-tan, text-red,
  // bg-surface, border-border) are NOT matched — only Tailwind defaults, which
  // are fixed colours that cannot follow a theme.
  { re: /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:black|white)\b/g, what: "a Tailwind black/white utility" },
  { re: /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:slate|gray|zinc|neutral|stone|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-\d{2,3}\b/g, what: "a Tailwind default-palette utility" },
  // Direction-bearing: mixing toward literal white/black brightens on dark and
  // washes out on light. Mix toward a token that flips (e.g. --tan) instead.
  { re: /color-mix\([^)]*\b(?:white|black)\b/g, what: "a color-mix() toward literal white/black" },
];

/** Strip comments so prose like `// "#256"` can't be read as a colour. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (path.relative(SRC, full).split(path.sep).some((p) => p in SKIP_DIRS)) continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("components must not hardcode colours", () => {
  const files = sourceFiles(SRC);

  it("finds source files to scan (guards against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [path.relative(SRC, f), f] as const))(
    "%s uses tokens, not literal colours",
    (rel, full) => {
      const src = stripComments(readFileSync(full, "utf-8"));
      const hits = PATTERNS.flatMap(({ re, what }) =>
        [...src.matchAll(re)].map((m) => `${what}: ${m[0].trim()}`),
      );
      if (rel in ALLOWED) {
        // An allowlisted file must still actually contain something — a stale
        // entry silently exempts a file that has since been cleaned up.
        expect(
          hits.length,
          `${rel} is in ALLOWED ("${ALLOWED[rel]}") but no longer hardcodes any colour. Remove its entry so the file goes back to being checked.`,
        ).toBeGreaterThan(0);
        return;
      }
      expect(
        hits,
        `${rel} hardcodes ${hits.length === 1 ? "a colour" : "colours"}:\n` +
          hits.map((h) => `    ${h}`).join("\n") +
          `\n\n  A literal colour cannot follow the theme: it will look correct in whichever\n` +
          `  theme it was written for and wrong in every other one, and theme-contrast.test.ts\n` +
          `  cannot see it. Use a var(--token) from index.css instead — add a token if none fits,\n` +
          `  giving it a value in EVERY theme block. If this colour genuinely must be absolute\n` +
          `  (a third-party logo, a scrim), add "${rel}" to ALLOWED in this file with the reason.`,
      ).toEqual([]);
    },
  );
});
