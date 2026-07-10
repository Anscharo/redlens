// Regression test: computeLevels' NR-target recursion needs the same cycle
// guard emitDoc already has (atlas-parser.mjs's `emitted` set) — otherwise a
// self-referential or mutually-referential "Needed Research" target chain
// overflows the call stack instead of failing gracefully.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import for parser access
import { computeLevels } from "../scripts/lib/atlas-parser.mjs";

describe("computeLevels NR cycle guard", () => {
  it("terminates on a self-referential NR target", () => {
    const docs = [
      { uuid: "nr-1", doc_no: "NR-1", targets: ["nr-1"], folderPath: ["A"] },
    ];
    expect(() => computeLevels(docs, "/nonexistent")).not.toThrow();
    const levels = computeLevels(docs, "/nonexistent");
    expect(levels.get("nr-1")).toBeGreaterThanOrEqual(1);
    expect(levels.get("nr-1")).toBeLessThanOrEqual(6);
  });

  it("terminates on a mutually-referential NR target cycle", () => {
    const docs = [
      { uuid: "nr-1", doc_no: "NR-1", targets: ["nr-2"], folderPath: ["A"] },
      { uuid: "nr-2", doc_no: "NR-2", targets: ["nr-1"], folderPath: ["A"] },
    ];
    expect(() => computeLevels(docs, "/nonexistent")).not.toThrow();
    const levels = computeLevels(docs, "/nonexistent");
    expect(levels.get("nr-1")).toBeGreaterThanOrEqual(1);
    expect(levels.get("nr-2")).toBeGreaterThanOrEqual(1);
  });

  it("still computes the ordinary NR chain (target's level + 1, capped at 6)", () => {
    const docs = [
      { uuid: "core-1", doc_no: "A.1", targets: [], folderPath: ["A", "1"] },
      { uuid: "nr-1", doc_no: "NR-1", targets: ["core-1"], folderPath: ["A"] },
    ];
    const levels = computeLevels(docs, "/nonexistent");
    expect(levels.get("nr-1")).toBe(levels.get("core-1")! + 1);
  });
});
