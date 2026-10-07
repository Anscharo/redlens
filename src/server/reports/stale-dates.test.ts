// Pure unit test for the stale_dates report builder. Runs under `bun test`
// (NOT vitest — src/server is excluded there). Exercises the full path: the
// ix-adapter projects docs, then the shared src/lib/staleDates.ts derivation
// runs against a fixed "today" (the builder's 3rd param) so all three buckets
// — including due_soon's moving 7-day window — are deterministic.
import { test, expect } from "bun:test";
import { buildStaleDatesReportTool } from "./stale-dates.ts";
import type { Indexes, AtlasNode } from "../retrieval/indexes.ts";
import { buildVoteIndex } from "../../lib/votes/vote-index.ts";

const TODAY = new Date("2026-06-11T12:00:00Z");

function node(id: string, doc_no: string, title: string, content: string): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 3, parentId: null, order: 0, content, contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}

// One claim per bucket relative to TODAY (2026-06-11), plus a doc with no
// dates at all — mirrors the "one doc per bucket" fixture in the shared lib's
// own staleDates.test.ts.
function makeIx(): Indexes {
  const docs = [
    node("A", "A.9.1", "Old Promise", "The transfer will be included in the March 26, 2026 Executive Vote."), // past → stale
    node("B", "A.9.2", "Due This Week", "The vote will be held on June 15, 2026."), // +4d → due_soon
    node("C", "A.9.3", "Far Future", "The freeze will end in September 2026."), // far → upcoming
    node("D", "A.9.4", "No Dates Here", "Plain prose with no dates at all."),
  ];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  return {
    docMap,
    byDocNo: new Map(docs.map((d) => [d.doc_no, d])),
    entities: [],
    edges: [],
    meta: { atlasCommit: "test" },
  } as unknown as Indexes;
}

test("buildStaleDatesReportTool buckets each claim against the given today", () => {
  const r = buildStaleDatesReportTool(makeIx(), { include_provenance: true }, TODAY) as any;
  expect(r.report).toBe("stale_dates");
  expect(r.stale.map((c: any) => c.docNo)).toEqual(["A.9.1"]);
  expect(r.due_soon.map((c: any) => c.docNo)).toEqual(["A.9.2"]);
  expect(r.upcoming.map((c: any) => c.docNo)).toEqual(["A.9.3"]);
  expect(r.total_date_mentions).toBe(3);
  expect(r.total).toBe(3);
});

test("include_provenance:false strips surrounding context but keeps the raw date text", () => {
  const r = buildStaleDatesReportTool(makeIx(), { include_provenance: false }, TODAY) as any;
  const row = r.stale.find((c: any) => c.docNo === "A.9.1");
  expect(row.context).toBe(row.raw);
  expect(row.contextBefore).toBe("");
});

test("filter scopes rows by the same fields the report page searches, across every bucket", () => {
  const r = buildStaleDatesReportTool(makeIx(), { include_provenance: true, filter: "Old Promise" }, TODAY) as any;
  expect(r.stale).toHaveLength(1);
  expect(r.due_soon).toHaveLength(0);
  expect(r.upcoming).toHaveLength(0);
});

const VOTES = buildVoteIndex({
  sources: { executives: "", polls: "", portal: null },
  executives: [
    {
      file: "2026/executive-vote-2026-03-26.md",
      date: "2026-03-26",
      frontmatterDate: null,
      outOfSchedule: false,
      title: "Genesis Funding Transfers",
      summary: "Transfer Genesis Capital to Keel.",
      address: "0x1",
      sections: [],
      portal: { key: "genesis", date: "2026-03-26", active: false, hasBeenCast: true, datePassed: null, dateExecuted: null },
    },
  ],
  polls: [],
});

test("recorded claims and vote evidence ride along when the vote record is given", () => {
  const ix = makeIx();
  const rec = node("E", "A.9.5", "Keel Transfer", "The transfer to Keel was included in the March 26, 2026 Executive Vote.");
  (ix.docMap as Map<string, AtlasNode>).set("E", rec);
  const r = buildStaleDatesReportTool(ix, { include_provenance: true }, TODAY, VOTES) as any;
  expect(r.recorded.map((c: any) => c.docNo)).toEqual(["A.9.5"]);
  // A one-executive record makes every term common, so the subject goes unchecked.
  expect(r.recorded[0].voteEvidence).toMatchObject({ status: "vote-on-date", vote: { url: "https://vote.sky.money/executive/genesis" } });
  expect(r.recorded[0].vote).toBeUndefined(); // the matcher's input stays internal
  expect(r.stale[0].voteEvidence.status).toBe("vote-on-date");
  expect(r.vote_record).toBe("executives 2026-03-26 → 2026-03-26");
  expect(r.total).toBe(4);
});

test("without a vote record the rows carry no evidence and the result says so", () => {
  const r = buildStaleDatesReportTool(makeIx(), { include_provenance: true }, TODAY, null) as any;
  expect(r.stale[0].voteEvidence).toBeUndefined();
  expect(r.vote_record).toMatch(/unavailable/);
});

test("defaults today to the real current date when omitted", () => {
  // No third argument — exercises the production call path (the tool
  // registry never passes `today`) without pinning a value that would rot.
  const r = buildStaleDatesReportTool(makeIx(), { include_provenance: true }) as any;
  expect(r.report).toBe("stale_dates");
  expect(r.total_date_mentions).toBe(3);
});
