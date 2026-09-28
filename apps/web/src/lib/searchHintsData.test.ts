// Structural checks on the cheat-sheet data itself. Deliberately NOT in
// workers/search-hints.artifact.test.ts: none of this needs the search index,
// and that file refuses to run without built artifacts. These should still
// fail loudly in a checkout that has never run `pnpm build:index`.
import { describe, it, expect } from "vitest";
import { HINT_GROUPS } from "./searchHintsData";
import { SLASH_COMMANDS } from "./shortcuts";

const EXAMPLES = HINT_GROUPS.flatMap((g) => g.hints.map((h) => ({ group: g.title, ...h })));

describe("search hints data", () => {
  it("is not silently empty", () => {
    expect(HINT_GROUPS.length).toBeGreaterThanOrEqual(4);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(12);
    for (const g of HINT_GROUPS) expect(g.hints.length).toBeGreaterThan(0);
  });

  it("gives every group a unique title and every example a unique query", () => {
    const titles = HINT_GROUPS.map((g) => g.title);
    expect(new Set(titles).size).toBe(titles.length);
    const queries = EXAMPLES.map((e) => e.query);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("gives every example a label and a description", () => {
    for (const e of EXAMPLES) {
      expect(e.label.trim(), `${e.query} has no label`).not.toBe("");
      expect(e.description.trim(), `${e.query} has no description`).not.toBe("");
    }
  });

  // A hint whose query is also a slash command would navigate instead of
  // searching when clicked.
  it("does not collide with the slash-command namespace", () => {
    const cmds = new Set(SLASH_COMMANDS.map((s) => s.cmd));
    for (const e of EXAMPLES) expect(cmds.has(e.query)).toBe(false);
  });
});
