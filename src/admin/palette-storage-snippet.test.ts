// @vitest-environment jsdom
// buildOverrideSnippet is the "copy as css" output — the only path by which a
// browser-local override becomes a real, shareable index.css patch. It must
// skip tokens that match their default (else every user's snippet includes
// every token) and group depth-* into its own :root block to mirror
// index.css's own layout.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildOverrideSnippet } from "./palette-storage";
import type { PaletteToken } from "./palette-tokens";

function styleTag(css: string) {
  const el = document.createElement("style");
  el.textContent = css;
  document.head.appendChild(el);
}

function token(name: string, group: PaletteToken["group"] = "surface"): PaletteToken {
  return { name, label: name, group, alpha: false };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  document.head.querySelectorAll("style").forEach((el) => el.remove());
});

describe("buildOverrideSnippet", () => {
  it("reports no tokens differing when the draft matches every default", () => {
    styleTag(":root { --snip-noop: #111111; }");
    const out = buildOverrideSnippet({ "snip-noop": "#111111" }, [token("snip-noop")]);
    expect(out).toBe(
      "/* Palette overrides — generated 2026-03-14 from /admin/palette\n   No tokens differ from defaults. */\n",
    );
  });

  it("treats a differently-formatted but equal color as matching the default (via normalize)", () => {
    styleTag(":root { --snip-equiv: #ffffff; }");
    // 3-digit shorthand for the same color as the stylesheet default.
    const out = buildOverrideSnippet({ "snip-equiv": "#fff" }, [token("snip-equiv")]);
    expect(out).toContain("No tokens differ from defaults.");
  });

  it("skips a registry token that has no entry in the draft at all", () => {
    styleTag(":root { --snip-untouched: #111111; }");
    const out = buildOverrideSnippet({}, [token("snip-untouched")]);
    expect(out).toContain("No tokens differ from defaults.");
  });

  it("emits a :root block with a changed token under its group comment", () => {
    styleTag(":root { --snip-bg: #111111; }");
    const out = buildOverrideSnippet({ "snip-bg": "#222222" }, [token("snip-bg", "surface")]);
    expect(out).toContain("/* Palette overrides — generated 2026-03-14 from /admin/palette");
    expect(out).toContain("Paste into src/index.css");
    expect(out).toContain(":root {\n  /* surface */\n  --snip-bg: #222222;\n}\n");
  });

  it("groups multiple changed tokens from the same group into one block", () => {
    styleTag(":root { --snip-a: #111111; --snip-b: #111111; }");
    const out = buildOverrideSnippet(
      { "snip-a": "#222222", "snip-b": "#333333" },
      [token("snip-a", "brand"), token("snip-b", "brand")],
    );
    expect(out).toContain("  /* brand */\n  --snip-a: #222222;\n  --snip-b: #333333;");
  });

  it("puts a changed depth-group token in its own trailing :root block", () => {
    styleTag(":root { --snip-surface: #111111; --snip-depth-1: #aa0000; }");
    const out = buildOverrideSnippet(
      { "snip-surface": "#222222", "snip-depth-1": "#bb1111" },
      [token("snip-surface", "surface"), token("snip-depth-1", "depth")],
    );
    // Two separate :root { blocks as their own lines (the header prose also
    // mentions ":root { }" inline, so anchor to whole-line matches only).
    const rootBlocks = out.match(/^:root \{$/gm) ?? [];
    expect(rootBlocks).toHaveLength(2);
    expect(out.indexOf("/* surface */")).toBeLessThan(out.indexOf("/* depth */"));
    expect(out).toContain("--snip-depth-1: #bb1111;");
  });

  it("emits just the depth block, with no leading semantic block or separator, when only a depth token changed", () => {
    styleTag(":root { --snip-depth-only: #aa0000; }");
    const out = buildOverrideSnippet(
      { "snip-depth-only": "#bb1111" },
      [token("snip-depth-only", "depth")],
    );
    expect(out).toBe(
      "/* Palette overrides — generated 2026-03-14 from /admin/palette\n" +
        "   Paste into src/index.css inside the appropriate :root { } block. */\n" +
        ":root {\n  /* depth */\n  --snip-depth-only: #bb1111;\n}\n",
    );
  });
});
