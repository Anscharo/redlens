// MiniSearch options parity. The search worker and the Bun server deserialize
// the prebuilt search-index.json (produced by build-index.mjs) via
// MiniSearch.loadJSON, which requires options identical to the build. The two
// TS consumers share src/lib/searchOptions.ts; build-index.mjs keeps its own
// inline literal (it runs under node and can't import the .ts). This test pins
// the shared options' behaviour AND asserts the .mjs literal hasn't drifted.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MINISEARCH_OPTIONS } from "../src/lib/searchOptions";

const buildIndexSrc = fs.readFileSync(
  path.resolve(__dirname, "../scripts/required/build-index.mjs"),
  "utf8",
);

describe("MINISEARCH_OPTIONS (shared)", () => {
  it("indexes the expected fields by id", () => {
    expect(MINISEARCH_OPTIONS!.fields).toEqual(["title", "doc_no", "type", "content"]);
    expect(MINISEARCH_OPTIONS!.idField).toBe("id");
  });

  it("processTerm strips edge punctuation, lowercases, and drops <2-char terms", () => {
    const pt = MINISEARCH_OPTIONS!.processTerm as (t: string) => string | null;
    expect(pt("`delegatedSigners`")).toBe("delegatedsigners");
    expect(pt("Foo.")).toBe("foo");
    expect(pt("a")).toBeNull();
    expect(pt("!?")).toBeNull();
  });
});

describe("build-index.mjs parity", () => {
  it("uses the same processTerm regex literal", () => {
    expect(buildIndexSrc).toContain("/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g");
  });

  it("uses the same fields and idField", () => {
    expect(buildIndexSrc).toContain('fields: ["title", "doc_no", "type", "content"]');
    expect(buildIndexSrc).toContain('idField: "id"');
  });
});
