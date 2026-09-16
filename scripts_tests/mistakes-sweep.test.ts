// The incremental sweep's job is to never lose a finding and never mark a
// document scanned that nobody read. Both failures are silent in production —
// the artifact still looks plausible — so they are pinned here instead.

import { describe, it, expect } from "vitest";
import { CATEGORY_LABELS } from "../src/lib/potentialMistakesIndex";
import {
  advanceState,
  buildBacklinks,
  CATEGORIES,
  chunkDocs,
  compareDocNo,
  dedupeIds,
  docDigest,
  docsToEvaluate,
  emptyState,
  isStateUsable,
  mergeFindings,
  planSweep,
  sortFindings,
  validateFinding,
  STATE_VERSION,
} from "../scripts/lib/mistakes-sweep.mjs";

type Node = {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  content: string;
  contentHash: string;
  file?: string;
};

const node = (over: Partial<Node> = {}): Node => ({
  id: "11111111-1111-1111-1111-111111111111",
  doc_no: "A.1.2",
  title: "A Title",
  type: "Core",
  content: "body text here",
  contentHash: "hash-a",
  ...over,
});

const stateOf = (nodes: Node[]) =>
  advanceState(emptyState(), Object.fromEntries(nodes.map((n) => [n.id, n])), nodes.map((n) => n.id));

describe("docDigest", () => {
  it("changes when the body changes", () => {
    expect(docDigest(node())).not.toBe(docDigest(node({ contentHash: "hash-b" })));
  });

  it("changes when the title or type changes — both carry findings of their own", () => {
    expect(docDigest(node())).not.toBe(docDigest(node({ title: "Other" })));
    expect(docDigest(node())).not.toBe(docDigest(node({ type: "Scope" })));
  });

  // Upstream renumbers wholesale (PR #235). Folding doc_no into the digest
  // would re-sweep all 11k documents for an editorial relabel.
  it("ignores doc_no, so a renumbering does not re-queue the corpus", () => {
    expect(docDigest(node())).toBe(docDigest(node({ doc_no: "B.9.9.9" })));
  });
});

describe("planSweep", () => {
  it("treats everything as new when there is no prior state", () => {
    const plan = planSweep([node()], emptyState());
    expect(plan.new).toHaveLength(1);
    expect(plan.unchanged).toHaveLength(0);
  });

  it("skips documents whose digest is unchanged", () => {
    const n = node();
    const plan = planSweep([n], stateOf([n]));
    expect(plan.unchanged).toEqual([n.id]);
    expect(plan.changed).toHaveLength(0);
  });

  it("queues a document whose body moved", () => {
    const before = node();
    const plan = planSweep([node({ contentHash: "hash-b" })], stateOf([before]));
    expect(plan.changed).toEqual([before.id]);
  });

  it("reports documents the atlas dropped as removed", () => {
    const gone = node({ id: "22222222-2222-2222-2222-222222222222" });
    const plan = planSweep([node()], stateOf([node(), gone]));
    expect(plan.removed).toEqual([gone.id]);
  });

  it("--full re-queues even unchanged documents", () => {
    const n = node();
    expect(planSweep([n], stateOf([n]), { full: true }).new).toEqual([n.id]);
  });
});

describe("buildBacklinks", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("indexes markdown UUID links by the document they point at", () => {
    const docs = [node({ id: A, content: `see [B.1 - Other](${B}) for detail` }), node({ id: B })];
    expect([...(buildBacklinks(docs).get(B) ?? [])]).toEqual([A]);
  });

  it("ignores a self-link", () => {
    expect(buildBacklinks([node({ id: A, content: `[self](${A})` })]).size).toBe(0);
  });

  // A link into a document the atlas has dropped is a dangling reference — the
  // citing document is the only place left to notice it from.
  it("keeps a link whose target is no longer in the corpus", () => {
    const docs = [node({ id: A, content: `[gone](${B})` })];
    expect([...(buildBacklinks(docs).get(B) ?? [])]).toEqual([A]);
  });
});

describe("planSweep cross-reference expansion", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  // A cites B. B's title moves; A's own text did not, so a per-document diff
  // skips it — and misses that A now names a title that no longer exists.
  const citer = (over: Partial<Node> = {}) => node({ id: A, content: `see [B](${B})`, ...over });

  it("re-queues an unchanged document that cross-references a changed one", () => {
    const before = [citer(), node({ id: B })];
    const after = [citer(), node({ id: B, title: "Renamed" })];
    const plan = planSweep(after, stateOf(before), { backlinks: buildBacklinks(after) });
    expect(plan.changed).toEqual([B]);
    expect(plan.linked).toEqual([A]);
    expect(plan.linkedBecause[A]).toEqual([B]);
    expect(plan.unchanged).toHaveLength(0);
  });

  it("re-queues a document whose target the atlas deleted", () => {
    const plan = planSweep([citer()], stateOf([citer(), node({ id: B })]), {
      backlinks: buildBacklinks([citer()]),
    });
    expect(plan.removed).toEqual([B]);
    expect(plan.linked).toEqual([A]);
  });

  // One hop. A cites B, C cites A; only B moved, so C stays skipped — otherwise
  // a one-word fix walks outward until it has re-read the corpus.
  it("expands one hop only", () => {
    const docs = [citer(), node({ id: B }), node({ id: C, content: `see [A](${A})` })];
    const moved = [citer(), node({ id: B, title: "Renamed" }), docs[2]];
    const plan = planSweep(moved, stateOf(docs), { backlinks: buildBacklinks(moved) });
    expect(plan.linked).toEqual([A]);
    expect(plan.unchanged).toEqual([C]);
  });

  it("leaves everything skipped when nothing the citer points at moved", () => {
    const docs = [citer(), node({ id: B })];
    const plan = planSweep(docs, stateOf(docs), { backlinks: buildBacklinks(docs) });
    expect(plan.linked).toHaveLength(0);
    expect(plan.unchanged).toEqual([A, B]);
  });

  it("sends new, changed and linked documents to the model", () => {
    const before = [citer(), node({ id: B })];
    const after = [citer(), node({ id: B, contentHash: "hash-z" }), node({ id: C })];
    const plan = planSweep(after, stateOf(before), { backlinks: buildBacklinks(after) });
    expect(docsToEvaluate(plan).sort()).toEqual([A, B, C].sort());
  });
});

describe("isStateUsable", () => {
  // A state written by a different digest recipe is incomparable; treating its
  // digests as current would mark changed documents clean forever.
  it("rejects a state from another version", () => {
    expect(isStateUsable({ version: STATE_VERSION, docs: {} })).toBe(true);
    expect(isStateUsable({ version: STATE_VERSION + 1, docs: {} })).toBe(false);
    expect(isStateUsable(null)).toBe(false);
  });
});

describe("chunkDocs", () => {
  it("never splits a document across chunks", () => {
    const docs = [node({ id: "a", content: "x".repeat(300) }), node({ id: "b", content: "y".repeat(300) })];
    const chunks = chunkDocs(docs, { maxBytes: 500 });
    expect(chunks).toHaveLength(2);
    expect(chunks.flat()).toHaveLength(2);
  });

  it("gives an over-budget document its own chunk rather than cutting it", () => {
    const chunks = chunkDocs([node({ content: "x".repeat(10_000) })], { maxBytes: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });
});

describe("validateFinding", () => {
  const n = node({ content: "the proscribed rate applies" });
  const map = { [n.id]: n };
  const base = {
    uuid: n.id,
    category: "wrong-word",
    severity: "high",
    pass: "language",
    quote: "the proscribed rate",
    issue: "means forbidden",
    fix: "prescribed",
  };

  it("accepts a well-formed finding and stamps the current doc_no", () => {
    const res = validateFinding(base, map);
    if (!res.ok) throw new Error(`expected a valid finding, got: ${res.reason}`);
    expect(res.finding).toMatchObject({ docNo: n.doc_no, uuid: n.id, id: "A.1.2#wrong-word" });
  });

  it("rejects a quote that is not verbatim in the document", () => {
    const res = validateFinding({ ...base, quote: "invented text" }, map);
    expect(res).toMatchObject({ ok: false, reason: "quote not found in document" });
  });

  it("matches a quote taken from the title", () => {
    expect(validateFinding({ ...base, quote: "A Title" }, map).ok).toBe(true);
  });

  it("rejects an unknown uuid, a bad severity, and a bad pass", () => {
    expect(validateFinding({ ...base, uuid: "nope" }, map).ok).toBe(false);
    expect(validateFinding({ ...base, severity: "critical" }, map).ok).toBe(false);
    expect(validateFinding({ ...base, pass: "vibes" }, map).ok).toBe(false);
  });

  it("rejects a finding missing its issue text", () => {
    expect(validateFinding({ ...base, issue: "  " }, map).ok).toBe(false);
  });

  // An unknown category renders a filter pill the report cannot decode back out
  // of the URL, so the pill silently does nothing.
  it("rejects a category outside the report's vocabulary", () => {
    expect(validateFinding({ ...base, category: "spelling" }, map)).toMatchObject({
      ok: false,
      reason: "bad category spelling",
    });
  });

  // `file` is stamped like id and docNo — agents are told not to supply it, and
  // a re-evaluated document must not lose the source file it already had.
  it("stamps the source file from the atlas, ignoring whatever the agent sent", () => {
    const withFile = { [n.id]: { ...n, file: "A.1 - The-Governance-Scope.md" } };
    const res = validateFinding({ ...base, file: "invented.md" }, withFile);
    if (!res.ok) throw new Error(res.reason);
    expect(res.finding.file).toBe("A.1 - The-Governance-Scope.md");
  });
});

describe("the category vocabulary", () => {
  // This module is .mjs and cannot import the report's TypeScript. The test can,
  // so the two lists are pinned here rather than left to drift.
  it("matches the report's CATEGORY_LABELS exactly", () => {
    expect([...CATEGORIES].sort()).toEqual(Object.keys(CATEGORY_LABELS).sort());
  });
});

describe("mergeFindings", () => {
  const f = (uuid: string, category = "typo") => ({
    id: `X#${category}`,
    docNo: "A.1",
    uuid,
    file: "",
    category,
    severity: "high",
    pass: "language",
    quote: "q",
    issue: "i",
    fix: "",
  });

  it("keeps findings for documents this run did not look at", () => {
    const out = mergeFindings([f("untouched")], [], new Set(["other"]));
    expect(out.findings.map((x) => x.uuid)).toEqual(["untouched"]);
    expect(out.kept).toBe(1);
  });

  // The point of re-evaluating: a defect fixed upstream must disappear rather
  // than linger because the new pass simply reported nothing for that doc.
  it("drops the old findings of a re-evaluated document", () => {
    const out = mergeFindings([f("swept")], [], new Set(["swept"]));
    expect(out.findings).toHaveLength(0);
    expect(out.replaced).toBe(1);
  });

  it("replaces rather than duplicates when the document is reported again", () => {
    const out = mergeFindings([f("swept")], [f("swept", "grammar")], new Set(["swept"]));
    expect(out.findings.map((x) => x.category)).toEqual(["grammar"]);
  });

  it("drops findings for documents the atlas no longer has", () => {
    const out = mergeFindings([f("gone")], [], new Set(), ["gone"]);
    expect(out.findings).toHaveLength(0);
  });

  // A corpus-wide row spans documents and belongs to none, so no chunk can
  // regenerate it — validateFinding requires a known uuid. Retiring it on a
  // sweep would delete a real finding nothing can rebuild.
  it("keeps a corpus-wide finding through a sweep of every document", () => {
    const corpus = { ...f("x"), uuid: null };
    const out = mergeFindings([corpus], [], new Set(["x", "y"]), ["z"]);
    expect(out.findings).toHaveLength(1);
  });

  it("retires a corpus-wide finding only when asked to", () => {
    const corpus = { ...f("x"), uuid: null };
    const out = mergeFindings([corpus], [], new Set(), [], { dropCorpus: true });
    expect(out.findings).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("sorts doc_no by numeric segment, not lexically", () => {
    expect(compareDocNo("A.9", "A.10")).toBeLessThan(0);
    expect(compareDocNo("A.2.10", "A.2.9")).toBeGreaterThan(0);
  });

  it("puts high severity first", () => {
    const mk = (severity: string, docNo: string) => ({ severity, docNo, category: "typo" });
    const out = sortFindings([mk("low", "A.1"), mk("high", "A.9"), mk("medium", "A.2")] as never);
    expect(out.map((x: { severity: string }) => x.severity)).toEqual(["high", "medium", "low"]);
  });

  it("disambiguates repeated ids so every row keeps a unique key", () => {
    const out = dedupeIds([{ id: "A#typo" }, { id: "A#typo" }, { id: "B#typo" }] as never);
    expect(out.map((x: { id: string }) => x.id)).toEqual(["A#typo", "A#typo-2", "B#typo"]);
  });
});

describe("advanceState", () => {
  it("records only the documents that were evaluated", () => {
    const a = node({ id: "a" });
    const b = node({ id: "b" });
    const next = advanceState(emptyState(), { a, b }, ["a"]);
    expect(Object.keys(next.docs)).toEqual(["a"]);
  });

  it("forgets removed documents so they stop showing as drift", () => {
    const a = node({ id: "a" });
    const next = advanceState(stateOf([a]), { a }, [], ["a"]);
    expect(next.docs).toEqual({});
  });
});
