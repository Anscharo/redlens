// Temporal context for the HTML-era curation LLM (history-timeline.mjs). Pure-function
// fixtures reusing the forward-trace node shape.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
// @ts-expect-error — .mjs without types
import { buildTimelineIndex, timelineFor, commitInfoIndex, enrichTimeline } from "../scripts/htmlhist/history-timeline.mjs";
// @ts-expect-error — .mjs without types
import { occKey, contentDupCounts } from "../scripts/htmlhist/history-occkey.mjs";

type Node = any;
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");
const node = (id: string, o: Partial<Node> & { order: number }): Node => ({
  title: o.title ?? id,
  doc_no: o.doc_no ?? null,
  type: o.type ?? "Core",
  section: o.section ?? "S",
  ancestors: o.ancestors ?? [],
  content: o.content ?? id,
  contentHash: o.contentHash ?? md5(o.content ?? id),
  structuralKey: o.structuralKey ?? `k:${id}`,
  order: o.order,
});
const keyOf = (sha: string, n: Node) => occKey(sha, n, contentDupCounts([n]));

describe("buildTimelineIndex + timelineFor", () => {
  // lineage A: introduced c1, unchanged c2 (exact-hash carry), edited c3 (structural-key carry).
  const a1 = node("a", { order: 0, content: "hello world this stays put for a while" });
  const a2 = node("a", { order: 0, content: "hello world this stays put for a while" });
  const a3 = node("a", { order: 0, content: "hello world this changed a little bit" });
  // lineage B: born at c2, unchanged through c3.
  const b2 = node("b", { order: 1, content: "a brand new document appearing later" });
  const b3 = node("b", { order: 1, content: "a brand new document appearing later" });
  const commits = [
    { sha: "c1000000", nodes: [a1] },
    { sha: "c2000000", nodes: [a2, b2] },
    { sha: "c3000000", nodes: [a3, b3] },
  ];
  const index = buildTimelineIndex(commits);

  it("finds the introduction commit and the last edit up to the queried occurrence", () => {
    const t = timelineFor(index, keyOf("c3000000", a3));
    expect(t).toEqual({ firstSeen: { sha: "c1000000" }, lastEdit: { sha: "c3000000" } });
  });

  it("reports no edit yet when queried at an occurrence before any content change", () => {
    const t = timelineFor(index, keyOf("c2000000", a2));
    expect(t).toEqual({ firstSeen: { sha: "c1000000" }, lastEdit: null });
  });

  it("a birth's firstSeen is its own commit, with no edit before it", () => {
    const t = timelineFor(index, keyOf("c2000000", b2));
    expect(t).toEqual({ firstSeen: { sha: "c2000000" }, lastEdit: null });
  });

  it("does not see edits that happen AFTER the queried occurrence's own commit", () => {
    // b is unchanged c2→c3, so this is a no-op case for "no future leakage", but confirms
    // querying an EARLIER occurrence never reports a LATER lastEdit than its own commit.
    const t = timelineFor(index, keyOf("c2000000", a2));
    expect(t?.lastEdit).toBeNull();
  });

  it("returns null for an unresolvable key", () => {
    expect(timelineFor(index, "ghost0000:deadbeef")).toBeNull();
  });
});

describe("commitInfoIndex + enrichTimeline", () => {
  const commitInfo = commitInfoIndex([
    { sha: "c1000000", date: "2024-01-01T00:00:00Z", pr: 10, prTitle: "Add the thing", changeSummary: "adds it" },
    { sha: "c3000000", date: "2024-03-01T00:00:00Z", pr: 30, prTitle: "Update the thing", changeSummary: "tweaks it" },
  ]);

  it("attaches date/pr/title/summary to both ends of a timeline", () => {
    const out = enrichTimeline({ firstSeen: { sha: "c1000000" }, lastEdit: { sha: "c3000000" } }, commitInfo);
    expect(out).toEqual({
      firstSeen: { sha: "c1000000", date: "2024-01-01T00:00:00Z", pr: 10, title: "Add the thing", summary: "adds it" },
      lastEdit: { sha: "c3000000", date: "2024-03-01T00:00:00Z", pr: 30, title: "Update the thing", summary: "tweaks it" },
    });
  });

  it("is null-safe for a missing timeline / missing lastEdit / unknown sha", () => {
    expect(enrichTimeline(null, commitInfo)).toBeNull();
    expect(enrichTimeline({ firstSeen: { sha: "c1000000" }, lastEdit: null }, commitInfo)).toEqual({
      firstSeen: { sha: "c1000000", date: "2024-01-01T00:00:00Z", pr: 10, title: "Add the thing", summary: "adds it" },
      lastEdit: null,
    });
    expect(enrichTimeline({ firstSeen: { sha: "ghost" }, lastEdit: null }, commitInfo)).toEqual({
      firstSeen: { sha: "ghost" },
      lastEdit: null,
    });
  });
});
