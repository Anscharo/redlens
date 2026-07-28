// Split from libraryIndex.test.ts to keep files near the ~150-line
// convention — covers sectionSlugFor's two early-exit paths: a family with
// no entry in GROUP_SECTION_HEADING at all, and a recognized family whose
// section heading text isn't present in the `headings` list passed in.
import { describe, it, expect } from "vitest";
import { parseLibraryIndex } from "./libraryIndex";
import type { LibraryHeading } from "./libraryHeadings";

const marker = (body: string) => `:::index\n${body}\n:::endindex\n`;

describe("parseLibraryIndex — unresolved family targets", () => {
  it("resolves a range target's slug to null (but keeps kind 'category') when its family has no GROUP_SECTION_HEADING entry", () => {
    const raw = marker("- Unknown range → Widgets 1–9");
    const entries = parseLibraryIndex(raw, []);
    expect(entries[0].targets).toEqual([{ label: "Widgets 1–9", slug: null, kind: "category" }]);
  });

  it("leaves a bare-family target unresolved when its family has no GROUP_SECTION_HEADING entry", () => {
    const raw = marker("- Unknown family → Widgets");
    const entries = parseLibraryIndex(raw, []);
    expect(entries[0].targets).toEqual([{ label: "Widgets", slug: null, kind: "unresolved" }]);
  });

  it("leaves a bare-family target unresolved when the recognized family's section heading is absent from `headings`", () => {
    // "Lifecycle" IS in GROUP_SECTION_HEADING, but we pass no matching heading.
    const raw = marker("- Agent Artifacts → Lifecycle");
    const headings: LibraryHeading[] = [{ level: 2, text: "Some Other Section", slug: "some-other-section" }];
    const entries = parseLibraryIndex(raw, headings);
    expect(entries[0].targets).toEqual([{ label: "Lifecycle", slug: null, kind: "unresolved" }]);
  });
});
