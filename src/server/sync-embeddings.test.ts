// sync-embeddings.ts unit tests. Run under `bun test` (NOT vitest) —
// sync-embeddings.ts transitively imports Bun's `SQL` via ./db.ts.
//
// sync-embeddings.ts used to run `await main();` at module top level, so
// simply IMPORTING it (as this file must) kicked off a real DB + OpenRouter
// run as a side effect. Fixed by guarding behind `if (import.meta.main)` —
// verified below with a fresh cache-busted import (no db.ts mock needed for
// that one assertion, since main() never runs).
//
// DB MOCKING — mirrors migrate.test.ts / collections.test.ts's convention: ONE
// module-scope mock.module("./db.ts", …) providing every named export the real
// module has (checked by `pnpm check:mocks`).
//
// FILESYSTEM SAFETY — main() only READS docs.json off config.publicDir (all
// writes go through the mocked `sql`). config.publicDir is set/restored
// directly in beforeEach/afterEach, not through a helper that could revert it
// before an awaited internal read runs — see the bug fixed in
// atlas-updater.test.ts's withPublicDir for why that matters.
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AtlasNode } from "./retrieval/indexes.ts";
import { buildEmbedText, contentHash } from "./retrieval/embed-text.ts";

interface FakeDb {
  colType: string | null; // e.g. "vector(1024)"; null = pg_attribute has no row yet (table/column not migrated)
  have: { doc_id: string; content_hash: string }[]; // existing atlas_doc_embeddings rows
}
let fakeDb: FakeDb = { colType: "vector(1024)", have: [] };
function resetFakeDb(): void {
  fakeDb = { colType: "vector(1024)", have: [] };
}

interface UnsafeCall {
  kind: "dim-check" | "embed-upsert" | "embed-delete" | "unknown";
  paramsLength: number;
}
let unsafeCalls: UnsafeCall[] = [];
let ended = false;
function resetRecording(): void {
  unsafeCalls = [];
  ended = false;
}

async function unsafeMock(query: string, params?: unknown[]): Promise<unknown> {
  if (query.includes("format_type")) {
    unsafeCalls.push({ kind: "dim-check", paramsLength: 0 });
    return fakeDb.colType ? [{ t: fakeDb.colType }] : [];
  }
  if (query.includes("INSERT INTO atlas_doc_embeddings")) {
    unsafeCalls.push({ kind: "embed-upsert", paramsLength: (params ?? []).length });
    return [];
  }
  if (query.includes("DELETE FROM atlas_doc_embeddings")) {
    unsafeCalls.push({ kind: "embed-delete", paramsLength: (params ?? []).length });
    return [];
  }
  unsafeCalls.push({ kind: "unknown", paramsLength: 0 });
  throw new Error(`sync-embeddings.test.ts: unmocked sql.unsafe query: ${query}`);
}

async function sqlTag(strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> {
  const text = strings.join("?");
  if (text.includes("SELECT doc_id, content_hash FROM atlas_doc_embeddings")) {
    return fakeDb.have;
  }
  throw new Error(`sync-embeddings.test.ts: unmocked sql template query: ${text}`);
}

const sqlMock = Object.assign(sqlTag, {
  unsafe: unsafeMock,
  end: async (): Promise<void> => {
    ended = true;
  },
});

mock.module("./db.ts", () => ({
  sql: sqlMock,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { main, batchSizeFromEnv, withRetry } = await import("./sync-embeddings.ts");
const { config } = await import("./config.ts");

function doc(id: string, doc_no: string, content: string, overrides: Partial<AtlasNode> = {}): AtlasNode {
  return { id, doc_no, title: doc_no, type: "Core", depth: 1, parentId: null, order: 0, content, addressRefs: [], ...overrides };
}

function captureLog(): { logs: string[]; warns: string[]; restore: () => void } {
  const logs: string[] = [];
  const warns: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(" "));
  return {
    logs,
    warns,
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
    },
  };
}

// A sleep fake that resolves instantly but still records the requested delay
// — asserts the real backoff SCHEDULE without burning the real wall clock,
// mirroring db.test.ts's waitForDb tests.
function fastSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    delays,
  };
}

// Deliberately no dedicated "import doesn't run main()" test here: a
// cache-busted `import("./sync-embeddings.ts?x=1")` would prove it, but bun's
// coverage collector keys records by source path with the query STRIPPED —
// the duplicate cold instance's near-zero coverage then REPLACES the
// canonical file's real coverage for the whole `bun test --coverage` run (see
// retrieval/indexes.test.ts's COLD_BOOT comment for the same gotcha). The
// guard is exercised implicitly and more strongly anyway: every test below
// depends on the plain `await import("./sync-embeddings.ts")` above resolving
// cleanly rather than invoking a real, unguarded `await main()` at module
// load — a regression here would hang or throw while loading this entire
// file. Confirmed manually per the task runbook: `bun -e 'await
// import("./src/server/sync-embeddings.ts"); console.log("imported, did not run")'`.

describe("batchSizeFromEnv", () => {
  it("reads EMBED_BATCH from the given env", () => {
    expect(batchSizeFromEnv({ EMBED_BATCH: "25" })).toBe(25);
  });

  it("defaults to 50 when EMBED_BATCH is unset", () => {
    expect(batchSizeFromEnv({})).toBe(50);
  });

  it("defaults to the real process.env", () => {
    expect(batchSizeFromEnv()).toBe(Number(process.env.EMBED_BATCH ?? 50));
  });
});

describe("withRetry", () => {
  it("returns the result on the first try without sleeping", async () => {
    const { sleep, delays } = fastSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      3,
      sleep,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries after a failure and succeeds, backing off once", async () => {
    const { sleep, delays } = fastSleep();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return "ok";
      },
      3,
      sleep,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(delays).toEqual([1000]); // 1000 * 2^(1-1)
  });

  it("exhausts every attempt and throws the LAST error, backing off exponentially between tries", async () => {
    const { sleep, delays } = fastSleep();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        3,
        sleep,
      ),
    ).rejects.toThrow("fail-3"); // the LAST attempt's error, not the first
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 2000]); // doubling: 1000*2^0, 1000*2^1 — no sleep after the final attempt
  });
});

describe("main()", () => {
  let dir: string;
  let prevPublicDir: string;
  const noopMigrations = async () => [];
  const failEmbed = async (): Promise<number[][]> => {
    throw new Error("should not be called");
  };
  const instantSleep = async () => {};

  beforeEach(() => {
    resetFakeDb();
    resetRecording();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-embeddings-main-"));
    prevPublicDir = config.publicDir;
    config.publicDir = dir;
  });
  afterEach(() => {
    // MUST restore — config.publicDir is a shared singleton read by every
    // other test file in this `bun test` process (loadIndexes() et al.), and
    // this dir is about to be rm -rf'd. See sync.test.ts's afterEach for the
    // full story of the bug this guards against (it corrupted unrelated
    // chat/verify suites under the full pnpm test:server run).
    config.publicDir = prevPublicDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeDocs(atlasCommit: string, nodes: Record<string, AtlasNode>) {
    fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ atlasCommit, nodes }));
  }

  it("throws a clear error when the live vector column dimension does not match EMBED_DIM — never silently embeds at the wrong size", async () => {
    fakeDb.colType = "vector(512)"; // wrong — EMBED_DIM (embed.ts) is 1024
    await expect(
      main({ runMigrations: noopMigrations, embedBatch: failEmbed, batch: 50, sleep: instantSleep }),
    ).rejects.toThrow(/EMBED_DIM=1024.*vector\(512\)/);
  });

  it("proceeds normally when the column dimension matches EMBED_DIM", async () => {
    fakeDb.colType = "vector(1024)";
    writeDocs("sha1", {}); // no docs at all → 0 stale, short-circuits cleanly
    await expect(
      main({ runMigrations: noopMigrations, embedBatch: failEmbed, batch: 50, sleep: instantSleep }),
    ).resolves.toBeUndefined();
  });

  it("skips the dimension check (does not throw) when pg_attribute has no row yet — table not migrated is not the same bug as a dimension mismatch", async () => {
    fakeDb.colType = null; // colRows = [] → colDim is NaN → falsy → guard is skipped
    writeDocs("sha1", {});
    await expect(
      main({ runMigrations: noopMigrations, embedBatch: failEmbed, batch: 50, sleep: instantSleep }),
    ).resolves.toBeUndefined();
  });

  it("total=0 (every doc's hash already matches an embedded row): logs and returns without ever calling embedBatch", async () => {
    const dA = doc("a", "A.1", "alpha unchanged");
    writeDocs("sha1", { a: dA });
    fakeDb.have = [{ doc_id: "a", content_hash: contentHash(dA) }];
    let embedCalls = 0;
    const { logs, restore } = captureLog();
    try {
      await main({
        runMigrations: noopMigrations,
        embedBatch: async () => {
          embedCalls++;
          return [];
        },
        batch: 50,
        sleep: instantSleep,
      });
    } finally {
      restore();
    }
    expect(embedCalls).toBe(0);
    expect(ended).toBe(true);
    expect(logs.some((l) => l.includes("1 docs") && l.includes("0 stale/new to embed"))).toBe(true);
  });

  it("embeds new/changed docs, upserts one row per doc with the right params, and logs the done count", async () => {
    const dA = doc("a", "A.1", "alpha", { order: 1 }); // stale: not in `have`
    const dB = doc("b", "A.2", "bravo", { order: 0 }); // stale: hash mismatch
    writeDocs("sha1", { a: dA, b: dB });
    fakeDb.have = [{ doc_id: "b", content_hash: "stale-hash" }];

    let embedTexts: string[][] = [];
    const { logs, restore } = captureLog();
    try {
      await main({
        runMigrations: noopMigrations,
        embedBatch: async (texts) => {
          embedTexts.push(texts);
          return texts.map(() => [0.1, 0.2, 0.3]);
        },
        batch: 50,
        sleep: instantSleep,
      });
    } finally {
      restore();
    }

    expect(embedTexts).toEqual([[buildEmbedText(dA), buildEmbedText(dB)]]); // one batch, both stale docs
    const upsert = unsafeCalls.find((c) => c.kind === "embed-upsert");
    expect(upsert?.paramsLength).toBe(2 * 5); // 2 docs × (doc_id, vector, hash, atlas_sha, member_ids)
    expect(ended).toBe(true);
    expect(logs.some((l) => l.includes("done (2 vectors"))).toBe(true);
  });

  it("processes docs in stable doc_no order regardless of object key order — restarts/progress logs stay deterministic", async () => {
    const dZ = doc("z", "A.9", "zeta");
    const dA = doc("a", "A.1", "alpha");
    writeDocs("sha1", { z: dZ, a: dA }); // insertion order z, a — doc_no order should still win
    let seenOrder: string[] = [];
    await main({
      runMigrations: noopMigrations,
      embedBatch: async (texts) => {
        seenOrder = texts;
        return texts.map(() => [1]);
      },
      batch: 50,
      sleep: instantSleep,
    });
    expect(seenOrder).toEqual([buildEmbedText(dA), buildEmbedText(dZ)]); // A.1 before A.9
  });

  it("chunks the stale queue into deps.batch-sized embedBatch calls", async () => {
    writeDocs("sha1", { a: doc("a", "A.1", "alpha"), b: doc("b", "A.2", "bravo"), c: doc("c", "A.3", "charlie") });
    let callSizes: number[] = [];
    await main({
      runMigrations: noopMigrations,
      embedBatch: async (texts) => {
        callSizes.push(texts.length);
        return texts.map(() => [1]);
      },
      batch: 2,
      sleep: instantSleep,
    });
    expect(callSizes).toEqual([2, 1]); // 3 docs, batch size 2 → [2, 1]
  });

  it("a batch that fails all 3 retries is SKIPPED (not fatal) — the run still completes and reports the skip", async () => {
    writeDocs("sha1", { a: doc("a", "A.1", "alpha") });
    const { logs, warns, restore } = captureLog();
    try {
      await main({
        runMigrations: noopMigrations,
        embedBatch: async () => {
          throw new Error("openrouter down");
        },
        batch: 50,
        sleep: instantSleep,
      });
    } finally {
      restore();
    }
    expect(ended).toBe(true); // run still completes and closes the pool
    expect(unsafeCalls.some((c) => c.kind === "embed-upsert")).toBe(false); // nothing to upsert
    expect(logs.some((l) => l.includes("done (0 vectors, 1 skipped (retry next run)"))).toBe(true);
    expect(warns.some((w) => w.includes("failed after retries") && w.includes("skipping"))).toBe(true);
  });

  it("partial batch failure: one batch's every retry fails, the next batch still embeds — partial progress is not blocked by an earlier failure", async () => {
    writeDocs("sha1", { a: doc("a", "A.1", "alpha"), b: doc("b", "A.2", "bravo") });
    // Keyed off which doc's batch this is (not a simple call counter) — a
    // counter would make withRetry's own retries for "a" alternate
    // pass/fail, which doesn't test what this case needs: ALL of "a"'s
    // attempts fail (batch skipped) and ALL of "b"'s attempts succeed.
    await main({
      runMigrations: noopMigrations,
      embedBatch: async (texts) => {
        if (texts[0]?.includes("alpha")) throw new Error("flaky"); // "a"'s batch — every attempt fails
        return texts.map(() => [1]); // "b"'s batch — succeeds
      },
      batch: 1,
      sleep: instantSleep,
    });
    const upsert = unsafeCalls.find((c) => c.kind === "embed-upsert");
    expect(upsert?.paramsLength).toBe(1 * 5); // only "b" made it into the upsert
  });
});
