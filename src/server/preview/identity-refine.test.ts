// Hermetic: a temp bundle directory, with the live store and the provider
// replaced by stubs.
import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRefining, refineIdentity, refineJob, startRefine, stopRefine, type IdentityJson } from "./identity-refine.ts";
import type { VectorDeps } from "./embeddings.ts";
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const ID = "11111111-0000-4000-8000-000000000001";
const body = (w: string) => [`The operator must ${w} the contract before the call.`, "```", `proxy.${w}(amount);`, "second line of the call", "```"].join("\n");
const OLD: SnapshotDoc = { id: ID, doc_no: "A.1", title: "Approve Spend", content: body("approve") };
const NEW: SnapshotDoc = { id: ID, doc_no: "A.1", title: "Swap Tokens", content: body("swap") };
const snap = (...docs: SnapshotDoc[]): Snapshot => new Map(docs.map((d) => [d.id, d]));

function bundle(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-refine-"));
  tmp.push(dir);
  const node = { type: "Core", depth: 2, parentId: null, order: 0, addressRefs: [], ...NEW };
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ nodes: { [ID]: node } }));
  return dir;
}
const read = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as IdentityJson;

/** Old and new text on different axes: a cosine of 0, a different document. */
const deps = (over: Partial<VectorDeps> = {}): VectorDeps => ({
  enabled: true,
  liveHashes: async () => new Map(),
  knownVectors: async () => new Map(),
  embedBatch: async (texts) => texts.map((t) => (t.startsWith("Approve") ? [1, 0] : [0, 1])),
  saveVectors: async () => {},
  evictVectors: async () => {},
  ...over,
});
const job = (files: string[]) => refineJob(files, snap(OLD), snap(NEW), { added: [], changed: [ID] });

describe("refineIdentity", () => {
  test("writes the whole verdict by meaning, under every name of each job", async () => {
    const dir = bundle();
    await refineIdentity(dir, [job(["identity.sky.json", "identity.json"]), job(["identity.repo.json"])], undefined, deps());
    for (const name of ["identity.sky.json", "identity.json", "identity.repo.json"]) {
      expect(read(dir, name).identitySwap[ID]).toEqual({ oldTitle: "Approve Spend", newTitle: "Swap Tokens" });
      expect(read(dir, name).formerUuid).toEqual({});
    }
  });

  test("a document the vector spares is absent from the verdict", async () => {
    const dir = bundle();
    await refineIdentity(dir, [job(["identity.json"])], undefined, deps({ embedBatch: async (texts) => texts.map(() => [1, 0]) }));
    expect(read(dir, "identity.json")).toEqual({ identitySwap: {}, formerUuid: {} });
  });

  test("no vectors, no file: the reader keeps what diff.json said", async () => {
    const dir = bundle();
    await refineIdentity(dir, [job(["identity.json"])], undefined, deps({ enabled: false }));
    expect(fs.existsSync(path.join(dir, "identity.json"))).toBe(false);
  });

  test("writes nothing into a bundle that was removed or is being rebuilt", async () => {
    const gone = bundle();
    await refineIdentity(gone, [job(["identity.json"])], undefined, deps({ embedBatch: async (t) => { fs.rmSync(gone, { recursive: true, force: true }); return t.map(() => [1, 0]); } }));
    expect(fs.existsSync(gone)).toBe(false);

    const rebuilt = bundle();
    const abort = new AbortController();
    await refineIdentity(rebuilt, [job(["identity.json"])], abort.signal, deps({ embedBatch: async (t) => { abort.abort(); return t.map(() => [1, 0]); } }));
    expect(fs.existsSync(path.join(rebuilt, "identity.json"))).toBe(false);
  });
});

describe("startRefine", () => {
  test("is pending while the lane runs, and not after", async () => {
    let finish!: () => void;
    const lane = startRefine("sha-a", "/nowhere", [job(["identity.json"])], () => new Promise<void>((r) => (finish = r)));
    expect(isRefining("sha-a")).toBe(true);
    await Promise.resolve();
    finish();
    await lane;
    expect(isRefining("sha-a")).toBe(false);
  });

  test("with nothing to judge it does not start", async () => {
    let ran = false;
    await startRefine("sha-b", "/nowhere", [], async () => { ran = true; });
    expect(ran).toBe(false);
    expect(isRefining("sha-b")).toBe(false);
  });

  test("a rebuild stops the old lane, and the old lane cannot clear the new one's state", async () => {
    const signals: AbortSignal[] = [];
    const finish: (() => void)[] = [];
    const run = (_d: string, _j: unknown, signal?: AbortSignal) => new Promise<void>((r) => { signals.push(signal!); finish.push(r); });
    const first = startRefine("sha-c", "/nowhere", [job(["identity.json"])], run);
    await Promise.resolve();
    const second = startRefine("sha-c", "/nowhere", [job(["identity.json"])], run);
    await Promise.resolve();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    finish[0]();
    await first;
    expect(isRefining("sha-c")).toBe(true);
    stopRefine("sha-c");
    finish[1]();
    await second;
    expect(isRefining("sha-c")).toBe(false);
  });

  test("a lane that throws is logged and leaves nothing pending", async () => {
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      await startRefine("sha-d", "/nowhere", [job(["identity.json"])], async () => { throw new Error("provider down"); });
      expect(isRefining("sha-d")).toBe(false);
    } finally {
      console.warn = origWarn;
    }
  });
});
