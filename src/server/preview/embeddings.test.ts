// Hermetic tests for the preview's vectors: a temp bundle directory, and the
// live store and the provider replaced by stubs passed in as deps.
import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPreviewEmbeddings, bodySimilarity, decodeVector, encodeVector, EMBEDDINGS_FILE, type PreviewEmbeddingsJson, type VectorDeps } from "./embeddings.ts";
import { buildEmbedText, contentHash } from "../retrieval/embed-text.ts";
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

interface Doc { id: string; doc_no: string; title: string; content: string; type?: string }
function bundle(docs: Doc[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-embeddings-"));
  tmp.push(dir);
  const nodes = Object.fromEntries(docs.map((d, i) => [d.id, { type: "Core", depth: 3, parentId: null, order: i, addressRefs: [], ...d }]));
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ nodes }));
  return dir;
}
const readFile = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, EMBEDDINGS_FILE), "utf8")) as PreviewEmbeddingsJson;
const hashOf = (d: { title: string; content: string }) => contentHash(d);

/** A unit vector along one axis, so a cosine is 1 (same axis) or 0. */
const axis = (i: number) => { const v = [0, 0, 0, 0]; v[i] = 1; return v; };

function deps(over: Partial<VectorDeps> & { embedded?: string[] } = {}): VectorDeps & { embedded: string[] } {
  const embedded = over.embedded ?? [];
  return {
    enabled: true,
    liveHashes: async () => new Map(),
    liveVectors: async () => new Map(),
    embedBatch: async (texts) => { embedded.push(...texts); return texts.map(() => axis(0)); },
    ...over,
    embedded,
  };
}

const STEPS = "The operator must approve the contract.\nIt then waits for the receipt.\nIt records the amount.\nIt reports the result to the relayer.";
const UNCHANGED: Doc = { id: "11111111-0000-4000-8000-000000000001", doc_no: "A.1", title: "Purpose", content: "This document states the purpose of the scope in full." };
const CHANGED: Doc = { id: "11111111-0000-4000-8000-000000000002", doc_no: "A.2", title: "Swap Tokens", content: STEPS };
// A parent whose children are thin key:value leaves is stored as ONE group.
const GROUP: Doc[] = [
  { id: "11111111-0000-4000-8000-000000000010", doc_no: "A.3", title: "Freezer Multisig", content: "The documents herein define the Freezer Multisig." },
  { id: "11111111-0000-4000-8000-000000000011", doc_no: "A.3.1", title: "Address", content: "0x1111111111111111111111111111111111111111" },
  { id: "11111111-0000-4000-8000-000000000012", doc_no: "A.3.2", title: "Required Number Of Signers", content: "2" },
];

describe("buildPreviewEmbeddings", () => {
  test("embeds only the rows the live store does not already hold", async () => {
    const dir = bundle([UNCHANGED, CHANGED]);
    const d = deps({ liveHashes: async () => new Map([[UNCHANGED.id, hashOf(UNCHANGED)], [CHANGED.id, "an-older-hash"]]) });
    const pv = await buildPreviewEmbeddings(dir, d);
    expect(d.embedded).toEqual([buildEmbedText(CHANGED)]);
    const file = readFile(dir);
    expect(file.rows.map((r) => r.id)).toEqual([CHANGED.id]);
    expect(file.rows[0]).toMatchObject({ hash: hashOf(CHANGED), memberIds: [CHANGED.id], attributionOnly: false });
    expect(decodeVector(file.rows[0].vector)).toEqual(axis(0));
    expect(file.missing).toBe(0);
    expect(pv?.byHash.get(hashOf(CHANGED))).toEqual(axis(0));
  });

  test("copies a vector the live store holds under another document, and embeds nothing", async () => {
    // The same text under a new UUID — a document that moved.
    const dir = bundle([CHANGED]);
    const d = deps({ liveVectors: async (hashes) => new Map(hashes.map((h) => [h, axis(2)])) });
    await buildPreviewEmbeddings(dir, d);
    expect(d.embedded).toEqual([]);
    expect(decodeVector(readFile(dir).rows[0].vector)).toEqual(axis(2));
  });

  test("a document stored as a group is not one the gate can compare", async () => {
    const dir = bundle([CHANGED, ...GROUP]);
    const pv = await buildPreviewEmbeddings(dir, deps());
    expect(pv?.plain.has(CHANGED.id)).toBe(true);
    expect(pv?.plain.has(GROUP[0].id)).toBe(false); // the anchor holds its children's values
    expect(pv?.plain.has(GROUP[1].id)).toBe(true); // a folded child keeps a vector of its own
    const anchor = readFile(dir).rows.find((r) => r.id === GROUP[0].id)!;
    expect([...anchor.memberIds].sort()).toEqual(GROUP.map((g) => g.id));
    expect(readFile(dir).rows.find((r) => r.id === GROUP[1].id)?.attributionOnly).toBe(true);
  });

  test("a failed batch costs its rows and is counted, and the build goes on", async () => {
    const dir = bundle([CHANGED]);
    const pv = await buildPreviewEmbeddings(dir, deps({ embedBatch: async () => { throw new Error("provider down"); } }));
    expect(pv).not.toBeNull();
    expect(readFile(dir)).toMatchObject({ rows: [], missing: 1 });
  });

  test("no key, or no live store: no vectors, no file, no throw", async () => {
    const off = bundle([CHANGED]);
    expect(await buildPreviewEmbeddings(off, deps({ enabled: false }))).toBeNull();
    expect(fs.existsSync(path.join(off, EMBEDDINGS_FILE))).toBe(false);
    const down = bundle([CHANGED]);
    expect(await buildPreviewEmbeddings(down, deps({ liveHashes: async () => { throw new Error("connection refused"); } }))).toBeNull();
    expect(fs.existsSync(path.join(down, EMBEDDINGS_FILE))).toBe(false);
  });
});

describe("the stored vector", () => {
  test("survives the file to float32 precision", () => {
    const v = [0.123456789, -0.5, 0, 1];
    const back = decodeVector(encodeVector(v));
    expect(back.length).toBe(4);
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i], 6));
  });
});

describe("bodySimilarity", () => {
  const snap = (docs: SnapshotDoc[]): Snapshot => new Map(docs.map((d) => [d.id, d]));
  const OLD: Doc = { ...CHANGED, title: "Approve Spend", content: STEPS.replace("approve the contract", "approve the spender") };

  test("scores a retitled document: new side from this build, old side from the live store", async () => {
    const dir = bundle([CHANGED]);
    const d = deps({
      embedBatch: async (texts) => { d.embedded.push(...texts); return texts.map(() => axis(0)); },
      liveVectors: async (hashes) => new Map(hashes.filter((h) => h === hashOf(OLD)).map((h) => [h, axis(1)])),
    });
    const pv = (await buildPreviewEmbeddings(dir, d))!;
    const score = await bodySimilarity(snap([OLD]), snap([CHANGED]), pv);
    expect(score?.(CHANGED.id)).toBe(0); // axis 1 against axis 0
    expect(d.embedded).toEqual([buildEmbedText(CHANGED)]); // the old side cost no call
  });

  test("embeds the old side when the base is behind the live store", async () => {
    const dir = bundle([CHANGED]);
    const d = deps();
    const pv = (await buildPreviewEmbeddings(dir, d))!;
    const score = await bodySimilarity(snap([OLD]), snap([CHANGED]), pv);
    expect(d.embedded).toEqual([buildEmbedText(CHANGED), buildEmbedText(OLD)]);
    expect(score?.(CHANGED.id)).toBe(1);
  });

  test("has no score for a document the gate would not judge by meaning", async () => {
    const dir = bundle([CHANGED, ...GROUP]);
    const pv = (await buildPreviewEmbeddings(dir, deps()))!;
    const sameTitle = await bodySimilarity(snap([{ ...OLD, title: "Swap  Tokens" }]), snap([CHANGED]), pv);
    expect(sameTitle).toBeUndefined();
    const group = await bodySimilarity(snap([{ ...GROUP[0], title: "Pauser Multisig", content: STEPS }]), snap([{ ...GROUP[0], content: STEPS }]), pv);
    expect(group).toBeUndefined();
  });

  test("a provider failure leaves the gate without a score, and does not throw", async () => {
    const dir = bundle([CHANGED]);
    let calls = 0;
    const d = deps({ embedBatch: async (texts) => { if (++calls > 1) throw new Error("provider down"); return texts.map(() => axis(0)); } });
    const pv = (await buildPreviewEmbeddings(dir, d))!;
    expect(await bodySimilarity(snap([OLD]), snap([CHANGED]), pv)).toBeUndefined();
  });
});
