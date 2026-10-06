// A description reaches the committed artifact only if it is valid, and a
// document is recorded as described only if its row came back. Both failures
// are silent — the artifact still looks plausible — so they are pinned here.

import { describe, it, expect } from "vitest";
import {
  AGENT_INSTRUCTIONS,
  BRIEFING_REPLY_INSTRUCTIONS,
  briefingEmbedText,
  briefingTextDiffers,
  countDiffering,
  pullBriefings,
  serializeArtifact,
  briefingQueue,
  contextDigest,
  seedAction,
  buildCitations,
  buildDependents,
  buildTree,
  isComplete,
  mergeBriefings,
  packSets,
  parentKey,
  parseRows,
  planBriefings,
  renderQueue,
  renderSet,
  spreadSample,
  unlink,
  validateBriefing,
} from "../scripts/lib/doc-briefings.mjs";
import { docDigest, docsToEvaluate, advanceState, emptyState, planSweep } from "../scripts/lib/mistakes-sweep.mjs";

type Node = { id: string; doc_no: string; title: string; type: string; content: string; contentHash: string };

const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const node = (n: number, doc_no: string, over: Partial<Node> = {}): Node => ({
  id: uuid(n),
  doc_no,
  title: `Title ${n}`,
  type: "Core",
  content: `Body of document ${n}.`,
  contentHash: `hash-${n}`,
  ...over,
});
const mapOf = (nodes: Node[]) => Object.fromEntries(nodes.map((n) => [n.id, n]));

// A.1 ─ A.1.1 ─ A.1.1.1
//    └─ A.1.2          and A.1.2 links to A.1.1.1
const corpus = (): Node[] => [
  node(1, "A.1"),
  node(2, "A.1.1"),
  node(3, "A.1.1.1"),
  node(4, "A.1.2", { content: `See [A.1.1.1 - Title 3](${uuid(3)}) for the rate.\nSecond line.` }),
];

const good = (n: number) => ({
  uuid: uuid(n),
  briefing: "Sets the rate that the Grove instance of the allocation primitive pays.",
  questions: ["What rate does the Grove allocation instance pay?", "Who sets the Grove allocation rate?"],
});

describe("tree", () => {
  it("keys a sibling set by the doc number minus its last segment", () => {
    expect(parentKey("A.1.2")).toBe("A.1");
    expect(parentKey("NR-4")).toBe("");
  });

  it("finds the nearest ancestor that exists when the string parent is no document", () => {
    const nodes = [node(1, "A.1"), node(2, "A.1.0.3.1", { type: "Annotation" })];
    const tree = buildTree(nodes);
    expect(tree.setOf.get(uuid(2))?.key).toBe("A.1.0.3");
    expect(tree.setOf.get(uuid(2))?.parent?.id).toBe(uuid(1));
    expect(tree.childrenOf.get(uuid(1))?.map((c) => c.id)).toEqual([uuid(2)]);
  });
});

describe("what goes stale", () => {
  const described = (nodes: Node[]) => advanceState(emptyState(), mapOf(nodes), nodes.map((n) => n.id));

  it("does not re-queue anything for a renumbering", () => {
    const before = corpus();
    const after = before.map((n) => ({ ...n, doc_no: n.doc_no.replace(/^A\.1/, "A.7") }));
    expect(docDigest(after[0])).toBe(docDigest(before[0]));
    const plan = planSweep(after, described(before), { backlinks: buildDependents(after) });
    expect(docsToEvaluate(plan)).toEqual([]);
  });

  it("re-queues a moved document's children and link targets, and stops at one hop", () => {
    const before = corpus();
    const after = corpus();
    after[0] = { ...after[0], contentHash: "edited" }; // A.1 moved
    const plan = planSweep(after, described(before), { backlinks: buildDependents(after) });
    expect(plan.changed).toEqual([uuid(1)]);
    // Its children, not its grandchild.
    expect(plan.linked.sort()).toEqual([uuid(2), uuid(4)]);
    expect(plan.unchanged).toEqual([uuid(3)]);
  });

  it("re-queues the target of a moved document's link", () => {
    const before = corpus();
    const after = corpus();
    after[3] = { ...after[3], contentHash: "edited" }; // the citer moved
    const plan = planSweep(after, described(before), { backlinks: buildDependents(after) });
    expect(plan.linked).toEqual([uuid(3)]);
  });
});

describe("a corpus described in sittings", () => {
  // Only A.1.1.1 (3) is described. Its parent (2) and its citer (4) are not.
  const partial = (nodes: Node[]) => advanceState(emptyState(), mapOf(nodes), [uuid(3)]);

  it("does not re-queue a finished row because its parent or citer is not described yet", () => {
    const nodes = corpus();
    const plan = planBriefings(nodes, partial(nodes));
    expect(plan.linked).toEqual([]);
    expect(plan.unchanged).toEqual([uuid(3)]);
    expect(docsToEvaluate(plan).sort()).toEqual([uuid(1), uuid(2), uuid(4)]);
  });

  it("still re-queues it when something it depends on changed", () => {
    const before = corpus();
    const state = advanceState(emptyState(), mapOf(before), [uuid(3), uuid(4)]);
    const after = corpus();
    after[3] = { ...after[3], contentHash: "edited" };
    const plan = planBriefings(after, state);
    expect(plan.linked).toEqual([uuid(3)]);
    expect(plan.linkedBecause[uuid(3)]).toEqual([uuid(4)]);
  });

  it("expands from a new document once the corpus is complete", () => {
    const before = corpus();
    const state = { ...advanceState(emptyState(), mapOf(before), before.map((n) => n.id)), complete: true };
    expect(isComplete(before, state)).toBe(true);
    const after = [...before, node(5, "A.1.3", { content: `Overrides [A.1.1 - Title 2](${uuid(2)}).` })];
    expect(isComplete(after, state)).toBe(false);
    const plan = planBriefings(after, state);
    expect(plan.new).toEqual([uuid(5)]);
    expect(plan.linked).toEqual([uuid(2)]);
  });
});

describe("a partial run", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `d${i}`);

  it("takes whole runs spread from the first document to the last", () => {
    const kept = spreadSample(ids, 400, 100);
    expect(kept).toHaveLength(400);
    // Whole runs, in order, and not all from one end.
    const runs = [...new Set(kept.map((id) => Math.floor(Number(id.slice(1)) / 100)))];
    expect(runs).toHaveLength(4);
    expect(runs[0]).toBeLessThan(3);
    expect(runs.at(-1)).toBeGreaterThan(6);
    for (const run of runs) expect(kept.filter((id) => Math.floor(Number(id.slice(1)) / 100) === run)).toHaveLength(100);
  });

  it("returns everything when asked for at least everything", () => {
    expect(spreadSample(ids, 5000, 100)).toEqual(ids);
  });
});

describe("chunk text", () => {
  it("offers the agent no doc number and no UUID to copy from a link", () => {
    expect(unlink(`See [A.1.1.1 - Title 3](${uuid(3)}) and [NR-4 - Open Item](${uuid(9)}).`)).toBe(
      "See Title 3 and Open Item.",
    );
  });

  it("quotes the citing line under the cited document", () => {
    const nodes = corpus();
    const citations = buildCitations(nodes);
    expect(citations.get(uuid(3))).toEqual([{ from: nodes[3], line: "See Title 3 for the rate." }]);
  });

  it("renders a whole set, marking the members that owe no row", () => {
    const nodes = corpus();
    const tree = buildTree(nodes);
    const text = renderSet(tree.setOf.get(uuid(2))!, { tree, citations: buildCitations(nodes), write: new Set([uuid(4)]) });
    expect(text).toContain("Parent: Title 1 [Core]");
    expect(text).toMatch(new RegExp(`UUID: ${uuid(2)}\nCONTEXT ONLY`));
    expect(text).toMatch(new RegExp(`UUID: ${uuid(4)}\nWRITE`));
    expect(text).toContain("Children (1): Title 3");
    // The only doc numbers in a chunk would come from a body; none from the layout.
    expect(text).not.toMatch(/A\.1/);
  });

  it("renders only the sets that hold a queued document, and lists only what is owed", () => {
    const nodes = corpus();
    const rendered = renderQueue(nodes, [uuid(4)]);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].docs).toEqual([uuid(4)]);
  });

  it("never splits a set across chunks, and gives an oversized set its own chunk", () => {
    const item = (chars: number, docs: string[]) => ({ set: null, text: "x".repeat(chars), docs });
    const chunks = packSets([item(30, ["a"]), item(500, ["b", "c"]), item(30, ["d"]), item(30, ["e"])], { maxBytes: 100 });
    expect(chunks.map((c: { docs: string[] }) => c.docs)).toEqual([["a"], ["b", "c"], ["d", "e"]]);
  });

  it("caps the rows one agent owes", () => {
    const item = (docs: string[]) => ({ set: null, text: "x", docs });
    const chunks = packSets([item(["a", "b"]), item(["c", "d"]), item(["e"])], { maxRows: 3 });
    expect(chunks.map((c: { docs: string[] }) => c.docs)).toEqual([["a", "b"], ["c", "d", "e"]]);
  });
});

describe("agent output", () => {
  it("reads a truncated file as unprocessed, not as a short chunk", () => {
    expect(parseRows(`${JSON.stringify(good(3))}\n{"uuid":"0000`)).toBeNull();
    expect(parseRows("")).toEqual([]);
    expect(parseRows(`${JSON.stringify(good(3))}\n\n`)).toHaveLength(1);
  });

  it("accepts a valid row and keeps only what the model may supply", () => {
    const nodes = corpus();
    const result = validateBriefing({ ...good(3), digest: "forged", model: "forged" }, mapOf(nodes));
    expect(result.ok).toBe(true);
    expect(result.uuid).toBe(uuid(3));
    expect(Object.keys(result.entry ?? {})).toEqual(["briefing", "questions"]);
  });

  it.each([
    ["an unknown uuid", { uuid: uuid(99) }, /unknown uuid/],
    ["a doc number in the briefing", { briefing: "Sets the rate that A.1.2 pays under the Grove allocation instance." }, /doc number/],
    ["a Needed Research number", { briefing: "Tracks the open research item NR-4 for the Grove allocation instance." }, /doc number/],
    ["a doc number in a question", { questions: ["What does A.1.2 say about Grove?", "Who sets the Grove rate?"] }, /doc number/],
    ["a UUID", { briefing: `Sets the rate for the Grove instance, as ${uuid(1)} requires of it.` }, /UUID/],
    ["one question", { questions: ["What rate does the Grove instance pay?"] }, /2 or 3/],
    ["four questions", { questions: Array(4).fill("What rate does the Grove instance pay?") }, /2 or 3/],
    ["a question with no question mark", { questions: ["What rate does Grove pay?", "The Grove allocation rate."] }, /end with \?/],
    ["a briefing that is too short", { briefing: "Sets a rate." }, /chars/],
    ["a briefing that is too long", { briefing: "Sets the rate. ".repeat(40) }, /chars/],
    ["a missing briefing", { briefing: undefined }, /missing briefing/],
  ])("rejects %s", (_, over, reason) => {
    const result = validateBriefing({ ...good(3), ...over }, mapOf(corpus()));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it("rejects a briefing that only re-punctuates the document", () => {
    const nodes = [node(3, "A.1.1.1", { content: "The Grove instance pays the rate set by the facilitator each quarter." })];
    const result = validateBriefing(
      { ...good(3), briefing: "the grove instance pays the rate, set by the facilitator, each quarter" },
      mapOf(nodes),
    );
    expect(result).toEqual({ ok: false, reason: "briefing repeats the document" });
  });

  it("rejects a row for a document the chunk did not ask for", () => {
    const result = validateBriefing(good(3), mapOf(corpus()), new Set([uuid(4)]));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/did not ask for/);
  });
});

describe("merge", () => {
  it("stamps digest and model itself, replaces, keeps and drops", () => {
    const nodes = corpus();
    const nodeMap = mapOf(nodes);
    const previous = {
      [uuid(4)]: { briefing: "old four", questions: [], digest: "d4", model: "opus" },
      [uuid(2)]: { briefing: "old two", questions: [], digest: "d2", model: "opus" },
      [uuid(9)]: { briefing: "gone", questions: [], digest: "d9", model: "opus" },
    };
    const entry = { briefing: good(3).briefing, questions: good(3).questions };
    const merged = mergeBriefings(previous, [{ uuid: uuid(3), entry }, { uuid: uuid(2), entry }], nodeMap, [uuid(9)], "sonnet");
    expect(merged).toMatchObject({ added: 1, replaced: 1, kept: 1 });
    // Sorted by UUID, so a renumbering does not reshuffle the committed file.
    expect(Object.keys(merged.briefings)).toEqual([uuid(2), uuid(3), uuid(4)]);
    expect(merged.briefings[uuid(3)]).toEqual({ ...entry, digest: docDigest(nodes[2]), model: "sonnet" });
    expect(merged.briefings[uuid(4)].model).toBe("opus");
  });
});

describe("instructions", () => {
  it("would pass their own no-doc-number rule", () => {
    // The instructions are read by every agent; a doc number in them is an
    // example to copy.
    expect(AGENT_INSTRUCTIONS).not.toMatch(/\b[A-Z]\.\d/);
    expect(BRIEFING_REPLY_INSTRUCTIONS).not.toMatch(/\b[A-Z]\.\d/);
  });

  it("share one body and differ only in how the rows are delivered", () => {
    const body = AGENT_INSTRUCTIONS.slice(0, AGENT_INSTRUCTIONS.indexOf("- Write the rows to the output path"));
    expect(body.length).toBeGreaterThan(1000);
    expect(BRIEFING_REPLY_INSTRUCTIONS.startsWith(body)).toBe(true);
    expect(AGENT_INSTRUCTIONS).toMatch(/output path/);
    expect(BRIEFING_REPLY_INSTRUCTIONS).not.toMatch(/output path|Write tool/);
    expect(BRIEFING_REPLY_INSTRUCTIONS).toMatch(/no code\s+fence, no commentary/);
  });
});

describe("briefingEmbedText", () => {
  it("is the briefing, a newline, then the questions one per line", () => {
    expect(briefingEmbedText({ briefing: "B", questions: ["Q1?", "Q2?"] })).toBe("B\nQ1?\nQ2?");
    expect(briefingEmbedText({ briefing: "B" })).toBe("B\n");
  });
});

describe("contextDigest", () => {
  const digestOf = (nodes: Node[], n: number) => {
    const tree = buildTree(nodes);
    return contextDigest(nodes[n - 1], tree, buildCitations(nodes));
  };

  it("is 16 hex characters and stable", () => {
    expect(digestOf(corpus(), 3)).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf(corpus(), 3)).toBe(digestOf(corpus(), 3));
  });

  it("moves for a child when the parent is renamed, and not for a sibling edit", () => {
    const before = digestOf(corpus(), 3);
    const renamed = corpus();
    renamed[1] = { ...renamed[1], title: "Renamed parent", contentHash: "other" };
    expect(digestOf(renamed, 3)).not.toBe(before);
    // Documents 2 and 4 are siblings and 4 does not cite 2, so editing 4 leaves 2 alone.
    const sibling = corpus();
    sibling[3] = { ...sibling[3], contentHash: "edited" };
    expect(digestOf(sibling, 2)).toBe(digestOf(corpus(), 2));
  });

  it("moves when a citer changes", () => {
    const changed = corpus();
    changed[3] = { ...changed[3], contentHash: "edited" };
    expect(digestOf(changed, 3)).not.toBe(digestOf(corpus(), 3));
  });
});

describe("seedAction", () => {
  const seed = { digest: "d1" };
  it("inserts when there is no row, or only a placeholder", () => {
    expect(seedAction(undefined, seed, "d1")).toBe("insert");
    expect(seedAction({ briefing: "", digest: "x" }, seed, "d1")).toBe("insert");
  });
  it("replaces a stale row when the seed is current", () => {
    expect(seedAction({ briefing: "old", digest: "d0" }, seed, "d1")).toBe("replace");
  });
  it("keeps a row at the live digest, and a stale row when the seed is stale too", () => {
    expect(seedAction({ briefing: "worker text", digest: "d1" }, seed, "d1")).toBe("keep");
    expect(seedAction({ briefing: "old", digest: "d0" }, seed, "d2")).toBe("keep");
  });
  it("skips a document that is not live", () => {
    expect(seedAction(undefined, seed, undefined)).toBe("skip");
    expect(seedAction({ briefing: "old", digest: "d0" }, seed, undefined)).toBe("skip");
  });
});

describe("briefingQueue", () => {
  const rowAt = (nodes: Node[], n: number, over = {}) => {
    const tree = buildTree(nodes);
    return {
      briefing: "text",
      context_digest: contextDigest(nodes[n - 1], tree, buildCitations(nodes)),
      failures: 0,
      failed_context: null as string | null,
      ...over,
    };
  };

  it("queues documents with no row or a placeholder, in atlas order", () => {
    const nodes = corpus();
    const rows = new Map([
      [uuid(1), rowAt(nodes, 1)],
      [uuid(3), rowAt(nodes, 3, { briefing: "" })],
    ]);
    expect(briefingQueue(nodes, rows, 10)).toEqual([uuid(2), uuid(3), uuid(4)]);
  });

  it("cuts to the cap, and a cap of 0 queues nothing", () => {
    const nodes = corpus();
    expect(briefingQueue(nodes, new Map(), 2)).toEqual([uuid(1), uuid(2)]);
    expect(briefingQueue(nodes, new Map(), 0)).toEqual([]);
  });

  it("leaves a stale text row that failed three times at the live context, until the context moves", () => {
    const nodes = corpus();
    const rows = new Map(nodes.map((_, i) => [uuid(i + 1), rowAt(nodes, i + 1)]));
    // Document 2 is briefed at context C0; its parent is renamed, so the live context is C1.
    const c1 = corpus();
    c1[0] = { ...c1[0], title: "Renamed", contentHash: "other" };
    const live1 = contextDigest(c1[1], buildTree(c1), buildCitations(c1));
    rows.set(uuid(2), rowAt(nodes, 2, { failures: 2, failed_context: live1 }));
    expect(briefingQueue(c1, rows, 10)).toContain(uuid(2));
    rows.set(uuid(2), rowAt(nodes, 2, { failures: 3, failed_context: live1 }));
    expect(briefingQueue(c1, rows, 10)).not.toContain(uuid(2));
    // The live context moves again (C2): the spent count belongs to C1, so it queues again.
    const c2 = corpus();
    c2[0] = { ...c2[0], title: "Renamed again", contentHash: "again" };
    expect(briefingQueue(c2, rows, 10)).toContain(uuid(2));
  });

  it("leaves a placeholder that failed three times at the live context, until the context moves", () => {
    const nodes = corpus();
    const rows = new Map(nodes.map((_, i) => [uuid(i + 1), rowAt(nodes, i + 1)]));
    rows.set(uuid(2), rowAt(nodes, 2, { briefing: "", failures: 3, failed_context: rowAt(nodes, 2).context_digest }));
    expect(briefingQueue(nodes, rows, 10)).toEqual([]);
    rows.set(uuid(2), rowAt(nodes, 2, { briefing: "", failures: 2 }));
    expect(briefingQueue(nodes, rows, 10)).toEqual([uuid(2)]);
    // The parent is renamed: document 2's stored context no longer matches, so it queues again.
    const renamed = corpus();
    renamed[0] = { ...renamed[0], title: "Renamed", contentHash: "other" };
    rows.set(uuid(2), rowAt(nodes, 2, { briefing: "", failures: 3, failed_context: rowAt(nodes, 2).context_digest }));
    expect(briefingQueue(renamed, rows, 10)).toContain(uuid(2));
  });

  it("re-queues a briefed document whose context changed", () => {
    const nodes = corpus();
    const rows = new Map(nodes.map((_, i) => [uuid(i + 1), rowAt(nodes, i + 1)]));
    expect(briefingQueue(nodes, rows, 10)).toEqual([]);
    const changed = corpus();
    changed[3] = { ...changed[3], contentHash: "edited" };
    // 4 itself moved, and 3 is cited by 4.
    expect(briefingQueue(changed, rows, 10)).toEqual([uuid(3), uuid(4)]);
  });
});

describe("pull: the artifact the database writes back", () => {
  const row = (n: number, over = {}) => ({
    doc_id: uuid(n),
    briefing: `Briefing for document ${n}, long enough to be a real one.`,
    questions: [`What is document ${n}?`, `Where does document ${n} sit?`],
    digest: `digest-${n}`,
    model: "m",
    ...over,
  });

  it("serialises one row per line and parses back to the same rows", () => {
    const pulled = pullBriefings([row(2), row(1)]);
    const text = serializeArtifact(pulled, "abc");
    expect(text.split("\n")).toHaveLength(5); // head, two rows, tail, trailing newline
    const parsed = JSON.parse(text);
    expect(parsed.atlasSha).toBe("abc");
    expect(parsed.briefings).toEqual(pulled);
    expect(Object.keys(parsed.briefings)).toEqual([uuid(1), uuid(2)]);
  });

  it("writes the same bytes as a merge for the same row", () => {
    const n = node(1, "A.1");
    const merged = mergeBriefings({}, [{ uuid: n.id, entry: { briefing: "x".repeat(50), questions: ["Why?", "How come?"] } }], { [n.id]: n }, [], "m");
    const pulled = pullBriefings([
      { doc_id: n.id, briefing: "x".repeat(50), questions: ["Why?", "How come?"], digest: docDigest(n), model: "m" },
    ]);
    expect(serializeArtifact(pulled, "s")).toBe(serializeArtifact(merged.briefings, "s"));
  });

  it("leaves placeholder rows out", () => {
    expect(Object.keys(pullBriefings([row(1), row(2, { briefing: "" })]))).toEqual([uuid(1)]);
  });

  it("counts a row as differing when it is new or its text moved, not when only the digest did", () => {
    const file = pullBriefings([row(1), row(2)]);
    const pulled = pullBriefings([
      row(1, { digest: "other", model: "n" }),
      row(2, { questions: ["Something else entirely?"] }),
      row(3),
    ]);
    expect(briefingTextDiffers(file[uuid(1)], pulled[uuid(1)])).toBe(false);
    expect(countDiffering(file, pulled)).toBe(2);
    expect(countDiffering(pulled, pulled)).toBe(0);
  });
});
