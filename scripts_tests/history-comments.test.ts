import { describe, expect, it } from "vitest";
import { commentText, judgeComment, scanDiff } from "../scripts/lib/history-comments.mjs";

const whys = (text: string) => judgeComment(text).map((f) => f.why);

describe("judgeComment", () => {
  it("flags history: PR numbers, dates, 'used to', 'no longer'", () => {
    expect(whys("// fixed in PR #230")).toContain("PR number");
    expect(whys("// see #346 for the case")).toEqual(["PR/issue number"]);
    expect(whys("// measured 2026-08-21")).toEqual(["date"]);
    expect(whys("// this used to route FAST")).toEqual(['"used to"']);
    expect(whys("// the hook no longer mounts")).toEqual(["history phrasing"]);
  });

  it("passes present-tense invariants, passive 'is used to', colours and the opt-out", () => {
    expect(whys("// ethereum stays last so a label naming both resolves to the L2")).toEqual([]);
    expect(whys("// the key is used to look up the row")).toEqual([]);
    expect(whys("// fallback colour #fff")).toEqual([]);
    expect(whys("// atlas effective date 2026-01-01 history-ok")).toEqual([]);
  });
});

describe("commentText", () => {
  it("finds full-line and trailing comments, not URLs in strings", () => {
    expect(commentText("  // note")).toBe("// note");
    expect(commentText(" * jsdoc line")).toBe("* jsdoc line");
    expect(commentText("const a = 1; // why")).toBe("// why");
    expect(commentText('fetch("https://x.io/2026-01-01")')).toBeNull();
  });
});

describe("scanDiff", () => {
  it("reports added comment lines with their new-file line numbers, skipping exempt paths", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1,0 +10,2 @@",
      "+const a = 1;",
      "+// used to crash here",
      "+++ b/scripts/htmlhist/x.mjs",
      "@@ -1,0 +1 @@",
      "+// pre-#117 era",
      "+++ b/docs/x.md",
      "@@ -1,0 +1 @@",
      "+// PR #1",
    ].join("\n");
    expect(scanDiff(diff)).toEqual([{ path: "src/a.ts", line: 11, text: "// used to crash here", why: '"used to"' }]);
  });
});
