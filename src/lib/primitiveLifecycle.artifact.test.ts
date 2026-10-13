// Pins every lifecycle quote to the atlas document it cites, so an upstream
// edit to the wording fails here rather than leaving a misquote on the
// Primitives page. Run `pnpm build:index` first if public/ is stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "@/types";
import { LIFECYCLE_STEPS } from "./primitiveLifecycle";

const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../public/docs.json"), "utf8"),
).nodes;

describe("primitive lifecycle quotes", () => {
  for (const q of LIFECYCLE_STEPS.flatMap((s) => s.quotes)) {
    it(`quotes "${q.docTitle}" verbatim`, () => {
      const doc = docs[q.docId];
      expect(doc, `no document ${q.docId}`).toBeDefined();
      expect(doc.title).toBe(q.docTitle);
      expect(doc.content).toContain(q.text);
    });
  }
});
