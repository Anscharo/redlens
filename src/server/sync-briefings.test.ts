// sync-briefings.ts unit tests. Run under `bun test` (the module imports Bun's
// SQL through ./db.ts, which connects lazily, so nothing is mocked: the SQL
// lives behind BriefingStore and these tests hand the passes an in-memory one).
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import type { AtlasNode } from "./retrieval/indexes.ts";
import {
  embedPass,
  type Live,
  runBriefings,
  stripFences,
  writePass,
  type BriefingDeps,
  type BriefingStore,
  type BriefingWrite,
  type FailedDoc,
  type ModelReply,
  type StoredRow,
  type ToEmbed,
} from "./sync-briefings.ts";
import { briefingEmbedText, contextDigest, buildCitations, buildTree } from "../../scripts/lib/doc-briefings.mjs";
import { docDigest } from "../../scripts/lib/mistakes-sweep.mjs";

const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const doc = (n: number, doc_no: string): AtlasNode & { contentHash: string } => ({
  id: uuid(n),
  doc_no,
  title: `Title ${n}`,
  type: "Core",
  depth: 1,
  parentId: null,
  content: `Body of document ${n}.`,
  order: n,
  contentHash: `hash-${n}`,
  addressRefs: [],
});
const DOCS = [doc(1, "A.1"), doc(2, "A.1.1"), doc(3, "A.1.2")];
// The embed and off-switch paths read only `docs` (atlas order) from the live view.
const LIVE = { docs: DOCS } as unknown as Live;

const good = (n: number) => ({
  uuid: uuid(n),
  briefing: "Sets the rate that the Grove instance of the allocation primitive pays.",
  questions: ["What rate does the Grove allocation instance pay?", "Who sets the Grove allocation rate?"],
});

class FakeStore implements BriefingStore {
  rows = new Map<string, StoredRow & { questions: unknown; embedded_hash: string | null }>();
  seedHash: string | null = null;
  seedWrites: BriefingWrite[][] = [];
  workerWrites: BriefingWrite[] = [];
  bumps: FailedDoc[] = [];
  vectors: string[] = [];
  docs: AtlasNode[];
  constructor(docs: AtlasNode[] = DOCS) {
    this.docs = docs;
  }
  async loadSnapshot() {
    return { atlasSha: "abc", docs: this.docs };
  }
  async loadSeedHash() {
    return this.seedHash;
  }
  async loadRows() {
    return new Map(this.rows);
  }
  async upsertSeed(rows: BriefingWrite[], fileHash: string) {
    this.seedWrites.push(rows);
    this.seedHash = fileHash;
    for (const r of rows) this.put(r, "seed");
  }
  async upsertWorker(rows: BriefingWrite[]) {
    this.workerWrites.push(...rows);
    for (const r of rows) this.put(r, "worker");
  }
  async bumpFailures(docs: FailedDoc[]) {
    this.bumps.push(...docs);
  }
  async loadToEmbed(): Promise<ToEmbed[]> {
    return [...this.rows.values()].filter((r) => r.briefing !== "" && r.embedded_hash !== r.briefing_hash);
  }
  async writeVector(docId: string, _hash: string, _vec: number[]) {
    this.vectors.push(docId);
    const row = this.rows.get(docId)!;
    row.embedded_hash = row.briefing_hash;
  }
  put(r: BriefingWrite, _source: string) {
    this.rows.set(r.docId, {
      doc_id: r.docId,
      briefing: r.briefing,
      questions: r.questions,
      digest: r.digest,
      context_digest: r.contextDigest,
      failures: 0,
      failed_context: null,
      briefing_hash: createHash("sha256").update(briefingEmbedText(r)).digest("hex"),
      embedded_hash: null,
    });
  }
}

function deps(store: FakeStore, over: Partial<BriefingDeps> = {}): BriefingDeps & { requests: number; embedCalls: number } {
  const d = {
    requests: 0,
    embedCalls: 0,
    runMigrations: async () => [],
    store,
    readSeed: () => null,
    complete: async (): Promise<ModelReply> => {
      d.requests++;
      return { content: "", finishReason: "stop" };
    },
    embedBatch: async (texts: string[]) => {
      d.embedCalls++;
      return texts.map(() => [0.1, 0.2]);
    },
    model: "test/model",
    perCycle: 186,
    hasApiKey: true,
    noFetch: false,
    deadlineAt: Number.POSITIVE_INFINITY,
    now: () => Date.now(),
    sleep: async () => {},
    embedBatchSize: 50,
    ...over,
  };
  return d;
}

const seedBytes = (briefings: Record<string, unknown>) => Buffer.from(JSON.stringify({ version: 1, briefings }));
const liveDigest = (n: number) => docDigest(DOCS[n - 1]!);

describe("seed pass", () => {
  it("writes the rows, then skips when the file hash matches", async () => {
    const store = new FakeStore();
    const bytes = seedBytes({
      [uuid(1)]: { ...good(1), digest: liveDigest(1), model: "m" },
      [uuid(2)]: { ...good(2), digest: liveDigest(2), model: "m" },
    });
    const d = deps(store, { readSeed: () => bytes, model: "" });
    await runBriefings(d);
    expect(store.seedWrites).toHaveLength(1);
    expect(store.seedWrites[0]).toHaveLength(2);
    expect(store.seedHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    await runBriefings(d);
    expect(store.seedWrites).toHaveLength(1);
  });

  it("applies seedAction per row: drops dead documents, keeps a worker row, replaces a stale one", async () => {
    const store = new FakeStore();
    const tree = buildTree(DOCS);
    const cites = buildCitations(DOCS);
    // 1: worker row at the live digest (kept). 2: stale row, seed current (replaced). 3: no row (inserted).
    store.put({ docId: uuid(1), briefing: "worker text that stays put", questions: ["Q?"], digest: liveDigest(1), contextDigest: contextDigest(DOCS[0], tree, cites), model: "w" }, "worker");
    store.put({ docId: uuid(2), briefing: "old text", questions: ["Q?"], digest: "stale", contextDigest: "x", model: "w" }, "worker");
    const bytes = seedBytes({
      [uuid(1)]: { ...good(1), digest: liveDigest(1), model: "m" },
      [uuid(2)]: { ...good(2), digest: liveDigest(2), model: "m" },
      [uuid(3)]: { ...good(3), digest: liveDigest(3), model: "m" },
      [uuid(99)]: { ...good(99), digest: "gone", model: "m" },
    });
    await runBriefings(deps(store, { readSeed: () => bytes, model: "" }));
    expect(store.seedWrites[0]!.map((r) => r.docId).sort()).toEqual([uuid(2), uuid(3)]);
    expect(store.rows.get(uuid(1))!.briefing).toBe("worker text that stays put");
    expect(store.rows.get(uuid(2))!.briefing).toBe(good(2).briefing);
  });

  it("is skipped when the file is absent", async () => {
    const store = new FakeStore();
    await runBriefings(deps(store, { model: "" }));
    expect(store.seedWrites).toHaveLength(0);
  });

  it("leaves a document with no content hash out of the live set", async () => {
    const hashless = { ...doc(1, "A.1"), contentHash: undefined };
    const store = new FakeStore([hashless]);
    const bytes = seedBytes({ [uuid(1)]: { ...good(1), digest: "undefined-digest", model: "m" } });
    await runBriefings(deps(store, { readSeed: () => bytes, model: "" }));
    expect(store.seedWrites[0]).toEqual([]);
  });
});

describe("write pass", () => {
  it("is off when the model is unset, the cap is 0, there is no key, or dev must not spend", async () => {
    for (const over of [{ model: "" }, { perCycle: 0 }, { hasApiKey: false }, { noFetch: true }]) {
      const store = new FakeStore();
      const d = deps(store, over);
      await runBriefings(d);
      expect(d.requests).toBe(0);
      expect(store.workerWrites).toHaveLength(0);
    }
  });

  it("counts nothing against any document when a chunk fails", async () => {
    for (const reply of [
      { content: "Sorry, I cannot help with that.", finishReason: "stop" },
      { content: JSON.stringify(good(1)), finishReason: "length" },
      { content: "", finishReason: "stop" },
    ]) {
      const store = new FakeStore();
      const d = deps(store, { complete: async () => reply });
      await runBriefings(d);
      expect(store.workerWrites).toHaveLength(0);
      expect(store.bumps).toHaveLength(0);
    }
  });

  it("counts nothing when the request itself keeps failing", async () => {
    const store = new FakeStore();
    let calls = 0;
    await runBriefings(deps(store, { complete: async () => { calls++; throw new Error("boom"); } }));
    expect(calls).toBe(3);
    expect(store.bumps).toHaveLength(0);
  });

  it("writes the valid rows and counts only the invalid document", async () => {
    const store = new FakeStore();
    const bad = { ...good(2), questions: ["Only one?"] };
    const content = ["```json", JSON.stringify(good(1)), JSON.stringify(bad), JSON.stringify(good(3)), "```"].join("\n");
    const d = deps(store, { complete: async () => ({ content, finishReason: "stop" }) });
    await runBriefings(d);
    expect(store.workerWrites.map((r) => r.docId).sort()).toEqual([uuid(1), uuid(3)]);
    expect(store.workerWrites[0]!.model).toBe("test/model");
    expect(store.bumps.map((b) => b.docId)).toEqual([uuid(2)]);
  });

  it("does not start a request after the deadline", async () => {
    const store = new FakeStore();
    const d = deps(store, { deadlineAt: 0 });
    await runBriefings(d);
    expect(d.requests).toBe(0);
  });
});

describe("embed pass", () => {
  it("updates only rows whose hash is distinct, in atlas order", async () => {
    const store = new FakeStore();
    for (const n of [3, 1, 2]) {
      store.put({ docId: uuid(n), briefing: `text ${n}`, questions: ["Q?"], digest: "d", contextDigest: "c", model: null }, "seed");
    }
    store.rows.get(uuid(2))!.embedded_hash = store.rows.get(uuid(2))!.briefing_hash; // already embedded
    store.rows.set(uuid(9), { ...store.rows.get(uuid(1))!, doc_id: uuid(9), briefing: "", embedded_hash: null }); // placeholder
    const d = deps(store);
    const n = await embedPass(d, LIVE);
    expect(n).toBe(2);
    expect(store.vectors).toEqual([uuid(1), uuid(3)]);
    expect(d.embedCalls).toBe(1);
  });

  it("sends the shared embed text", async () => {
    const store = new FakeStore();
    store.put({ docId: uuid(1), briefing: "B", questions: ["Q1?", "Q2?"], digest: "d", contextDigest: "c", model: null }, "seed");
    const seen: string[][] = [];
    await embedPass(deps(store, { embedBatch: async (t) => { seen.push(t); return t.map(() => [1]); } }), LIVE);
    expect(seen).toEqual([["B\nQ1?\nQ2?"]]);
  });
});

describe("stripFences", () => {
  it("removes a code fence and keeps the lines", () => {
    expect(stripFences('```json\n{"a":1}\n{"b":2}\n```')).toBe('{"a":1}\n{"b":2}');
  });
});

describe("write pass queue", () => {
  it("returns null stats when off", async () => {
    const live = LIVE;
    expect(await writePass(deps(new FakeStore(), { model: "" }), live)).toBeNull();
  });
});
