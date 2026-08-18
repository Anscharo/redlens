// sync.ts unit tests. Run under `bun test` (NOT vitest) — sync.ts transitively
// imports Bun's `SQL` via ./db.ts.
//
// sync.ts used to run `main().catch(...)` at module top level, so simply
// IMPORTING it (as this file must, to test anything in it) kicked off a real
// DB sync as a side effect. Fixed by guarding the invocation behind
// `if (import.meta.main)` — verify that fix still holds with a plain smoke
// test below (no db.ts mock needed for that one assertion).
//
// DB MOCKING — mirrors migrate.test.ts / collections.test.ts's convention: ONE
// module-scope mock.module("./db.ts", …) providing every named export the real
// module has (checked by `pnpm check:mocks`), with a swappable `fakeDb`
// fixture reset per test.
//
// FILESYSTEM SAFETY — main() reads docs.json/addresses.atlas.json/
// addresses.json from config.publicDir and writes NOTHING to disk itself (every
// "write" goes through the mocked `sql`; the on-chain snapshot is a DB row now,
// not chain-state.json, so it arrives through the same mock). config.publicDir
// is pointed at a fresh temp dir in beforeEach and restored in afterEach —
// directly in the hook bodies, not through a separate helper that returns a
// promise from inside a sync try/finally (that pattern silently reverts the
// override before an awaited callee's internal reads run — see the fix in
// atlas-updater.test.ts's withPublicDir for the bug this guards against).
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AtlasNode } from "./retrieval/indexes.ts";
import { contentHash } from "./retrieval/embed-text.ts";

interface FakeDb {
  prevSha: string | null; // sync_state.atlas_sha before this run; null = empty table
  before: { id: string; content_hash: string }[]; // existing atlas_doc_meta rows
  staleAddrCount: number; // rows the atlas_addresses GC delete reports removing
  // The chain_state row (migration 020) — null = no snapshot stored yet.
  chainState: { block: string | null; values: Record<string, unknown> } | null;
  chainStateError: string | null; // make the chain_state SELECT reject
}
const emptyFakeDb = (): FakeDb => ({
  prevSha: null, before: [], staleAddrCount: 0, chainState: null, chainStateError: null,
});
let fakeDb: FakeDb = emptyFakeDb();
function resetFakeDb(): void {
  fakeDb = emptyFakeDb();
}

interface UnsafeCall {
  kind: "doc-upsert" | "doc-delete" | "addr-upsert" | "unknown";
  paramsLength: number;
  params: unknown[];
}
let unsafeCalls: UnsafeCall[] = [];
let began = false;
let ended = false;
let syncStateWrite: { atlasSha: unknown } | null = null;
let syncLogWrite: { atlasSha: unknown; prevSha: unknown; inserted: unknown; updated: unknown; deleted: unknown } | null = null;

function resetTxRecording(): void {
  unsafeCalls = [];
  began = false;
  ended = false;
  syncStateWrite = null;
  syncLogWrite = null;
}

async function txTag(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> {
  const text = strings.join("?");
  if (text.includes("DELETE FROM atlas_addresses WHERE atlas_sha")) {
    return { count: fakeDb.staleAddrCount };
  }
  if (text.includes("INSERT INTO sync_state")) {
    syncStateWrite = { atlasSha: values[0] };
    return [];
  }
  if (text.includes("INSERT INTO sync_log")) {
    const [atlasSha, prevSha, inserted, updated, deleted] = values;
    syncLogWrite = { atlasSha, prevSha, inserted, updated, deleted };
    return [];
  }
  throw new Error(`sync.test.ts: unmocked tx template query: ${text}`);
}
const tx = Object.assign(txTag, {
  unsafe: async (query: string, params: unknown[]): Promise<unknown[]> => {
    const kind: UnsafeCall["kind"] = query.includes("INSERT INTO atlas_doc_meta")
      ? "doc-upsert"
      : query.includes("DELETE FROM atlas_doc_meta")
        ? "doc-delete"
        : query.includes("INSERT INTO atlas_addresses")
          ? "addr-upsert"
          : "unknown";
    unsafeCalls.push({ kind, paramsLength: params.length, params });
    return [];
  },
});

async function sqlTag(strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> {
  const text = strings.join("?");
  if (text.includes("SELECT atlas_sha FROM sync_state")) {
    return fakeDb.prevSha ? [{ atlas_sha: fakeDb.prevSha }] : [];
  }
  if (text.includes("SELECT id, content_hash FROM atlas_doc_meta")) {
    return fakeDb.before;
  }
  if (text.includes("FROM chain_state")) {
    if (fakeDb.chainStateError) throw new Error(fakeDb.chainStateError);
    return fakeDb.chainState
      ? [{ block: fakeDb.chainState.block, values: fakeDb.chainState.values, fetched_at: new Date() }]
      : [];
  }
  throw new Error(`sync.test.ts: unmocked sql template query: ${text}`);
}
const sqlMock = Object.assign(sqlTag, {
  // The callback param must NOT be named `tx` here — shadowing the outer
  // `const tx` inside its own `typeof tx` annotation is a circular type
  // reference (TS2502), not just a shadowing lint nit.
  begin: async (cb: (t: typeof tx) => Promise<void>): Promise<void> => {
    began = true;
    await cb(tx);
  },
  end: async (): Promise<void> => {
    ended = true;
  },
});

mock.module("./db.ts", () => ({
  sql: sqlMock,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
}));

const { main, chunked, readJson, pub, forceFromArgv } = await import("./sync.ts");
const { config } = await import("./config.ts");

function doc(id: string, doc_no: string, content: string, overrides: Partial<AtlasNode> = {}): AtlasNode {
  return { id, doc_no, title: doc_no, type: "Core", depth: 1, parentId: null, order: 0, content, addressRefs: [], ...overrides };
}

// sync.ts's own column arrays (docCols has 12 entries, addrCols has 14) — the
// upsert rowCount assertions below derive expected params.length from these
// so a future column addition doesn't silently make the test lie.
const DOC_COLS = 12;
const ADDR_COLS = 14;

function captureLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  return { logs, restore: () => (console.log = orig) };
}

// Deliberately no dedicated "import doesn't run main()" test here: a
// cache-busted `import("./sync.ts?x=1")` would prove it, but bun's coverage
// collector keys records by source path with the query STRIPPED — the
// duplicate cold instance's near-zero coverage then REPLACES the canonical
// file's real coverage for the whole `bun test --coverage` run (see
// retrieval/indexes.test.ts's COLD_BOOT comment for the same gotcha, and its
// child-process workaround). The guard is exercised implicitly and more
// strongly anyway: every test below depends on the plain `await
// import("./sync.ts")` above resolving cleanly rather than invoking a real
// main() and calling process.exit(1) from its .catch() — a regression here
// would abort this entire file (and pnpm test:server's exit code), not just
// fail one assertion. Confirmed manually per the task runbook:
// `bun -e 'await import("./src/server/sync.ts"); console.log("imported, did not run")'`.

describe("pure helpers", () => {
  it("pub() joins onto config.publicDir", () => {
    const prev = config.publicDir;
    config.publicDir = "/tmp/some-dir";
    try {
      expect(pub("docs.json")).toBe(path.join("/tmp/some-dir", "docs.json"));
    } finally {
      config.publicDir = prev;
    }
  });

  it("readJson() reads and parses a file relative to config.publicDir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-readjson-"));
    const prev = config.publicDir;
    config.publicDir = dir;
    try {
      fs.writeFileSync(path.join(dir, "thing.json"), JSON.stringify({ a: 1 }));
      expect(readJson<{ a: number }>("thing.json")).toEqual({ a: 1 });
    } finally {
      config.publicDir = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("forceFromArgv reads --force out of an argv array", () => {
    expect(forceFromArgv(["bun", "sync.ts", "--force"])).toBe(true);
    expect(forceFromArgv(["bun", "sync.ts"])).toBe(false);
    expect(forceFromArgv(["bun", "sync.ts", "--other-flag"])).toBe(false);
  });

  it("forceFromArgv defaults to the real process.argv", () => {
    // Not asserting a specific value (the test runner's own argv never has
    // --force) — just that the default parameter genuinely reads process.argv
    // rather than some hardcoded stub.
    expect(forceFromArgv()).toBe(process.argv.includes("--force"));
  });

  describe("chunked", () => {
    it("batches rows into chunks of the given size, including a short final chunk", async () => {
      const seen: number[][] = [];
      await chunked([1, 2, 3, 4, 5], 2, async (chunk) => {
        seen.push(chunk);
      });
      expect(seen).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("awaits each chunk before starting the next (sequential, not concurrent) — sync.ts relies on this to bound in-flight transaction size", async () => {
      const order: string[] = [];
      await chunked([1, 2, 3], 1, async (chunk) => {
        order.push(`start-${chunk[0]}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end-${chunk[0]}`);
      });
      // If chunks ran concurrently, every "start" would appear before any "end".
      expect(order).toEqual(["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
    });

    it("does nothing for an empty array", async () => {
      let calls = 0;
      await chunked([], 10, async () => {
        calls++;
      });
      expect(calls).toBe(0);
    });
  });
});

describe("main()", () => {
  let dir: string;
  let prevPublicDir: string;
  const noopMigrations = async () => [];

  beforeEach(() => {
    resetFakeDb();
    resetTxRecording();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-main-"));
    prevPublicDir = config.publicDir;
    config.publicDir = dir;
  });
  afterEach(() => {
    // MUST restore config.publicDir — config is a shared singleton read by
    // every other test file in this `bun test` process (loadIndexes() et al.
    // via config.publicDir), and this dir is about to be rm -rf'd. Leaving
    // the override in place after this describe finishes was a real bug here
    // (caught by the full `pnpm test:server` run corrupting unrelated
    // chat/verify suites that call loadIndexes() expecting the real atlas).
    config.publicDir = prevPublicDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeDocs(atlasCommit: string, nodes: Record<string, AtlasNode>) {
    fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ atlasCommit, nodes }));
  }
  function writeAddrAtlas(atlasCommit: string, addresses: Record<string, unknown>) {
    fs.writeFileSync(path.join(dir, "addresses.atlas.json"), JSON.stringify({ atlasCommit, addresses }));
  }

  it("sha-gate: skips the sync (no transaction) when prevSha === atlasSha and --force is not set", async () => {
    writeDocs("same-sha", { a: doc("a", "A.1", "alpha") });
    writeAddrAtlas("same-sha", {});
    fakeDb.prevSha = "same-sha";
    const { logs, restore } = captureLog();
    try {
      await main({ runMigrations: noopMigrations, force: false });
    } finally {
      restore();
    }
    expect(began).toBe(false); // no transaction attempted
    expect(ended).toBe(true); // still closes the pool
    expect(logs.some((l) => l.includes("already current"))).toBe(true);
  });

  it("--force bypasses the sha-gate even when prevSha === atlasSha", async () => {
    writeDocs("same-sha", { a: doc("a", "A.1", "alpha") });
    writeAddrAtlas("same-sha", {});
    fakeDb.prevSha = "same-sha";
    await main({ runMigrations: noopMigrations, force: true });
    expect(began).toBe(true);
    expect(syncStateWrite).toEqual({ atlasSha: "same-sha" });
  });

  it("classifies inserted / updated / removed docs by content_hash, ignoring doc_no/order churn (renumber-stable)", async () => {
    const dA = doc("a", "A.1", "alpha unchanged"); // same content as before → unchanged
    const dB = doc("b", "A.2", "bravo NEW content"); // content_hash differs from before → updated
    const dC = doc("c", "A.3", "charlie brand new"); // not in before at all → inserted
    writeDocs("new-sha", { a: dA, b: dB, c: dC });
    writeAddrAtlas("new-sha", {});
    fakeDb.prevSha = "old-sha";
    fakeDb.before = [
      { id: "a", content_hash: contentHash(dA) }, // matches → unchanged
      { id: "b", content_hash: "stale-hash-does-not-match" }, // mismatches → updated
      { id: "d", content_hash: "whatever" }, // absent from new docs → removed
    ];

    const { logs, restore } = captureLog();
    let result: unknown;
    try {
      result = await main({ runMigrations: noopMigrations, force: false });
    } finally {
      restore();
    }

    expect(result).toBeUndefined(); // main() returns void on the happy path too
    expect(began).toBe(true);
    expect(syncLogWrite).toMatchObject({ atlasSha: "new-sha", prevSha: "old-sha", inserted: 1, updated: 1, deleted: 1 });
    expect(logs.some((l) => l.includes("doc_meta: 1 inserted, 1 updated, 1 removed"))).toBe(true);

    const docUpsert = unsafeCalls.find((c) => c.kind === "doc-upsert");
    expect(docUpsert?.paramsLength).toBe(3 * DOC_COLS); // a, b, c all upserted (unchanged docs are upserted too — idempotent)
    const docDelete = unsafeCalls.find((c) => c.kind === "doc-delete");
    expect(docDelete).toBeDefined(); // "d" triggers the removed-doc DELETE branch
  });

  it("skips the doc-delete branch entirely when nothing was removed", async () => {
    const dA = doc("a", "A.1", "alpha");
    writeDocs("new-sha", { a: dA });
    writeAddrAtlas("new-sha", {});
    fakeDb.prevSha = "old-sha";
    fakeDb.before = [{ id: "a", content_hash: contentHash(dA) }];

    await main({ runMigrations: noopMigrations, force: false });

    expect(unsafeCalls.some((c) => c.kind === "doc-delete")).toBe(false);
  });

  it("expands a multi-chain address into one atlas_addresses row per chain, and folds the address GC count into the summary log", async () => {
    writeDocs("new-sha", { a: doc("a", "A.1", "alpha") });
    writeAddrAtlas("new-sha", {
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA": {
        chain: "ethereum",
        chains: ["ethereum", "base"], // deployed at the same address on 2 chains (e.g. a Safe)
        roles: ["multisig"],
        entityLabel: "Freezer Multisig",
        aliases: [],
        expectedTokens: [],
      },
    });
    fakeDb.prevSha = "old-sha";
    fakeDb.staleAddrCount = 3; // rows the GC delete claims to have removed

    const { logs, restore } = captureLog();
    try {
      await main({ runMigrations: noopMigrations, force: false });
    } finally {
      restore();
    }

    const addrUpsert = unsafeCalls.find((c) => c.kind === "addr-upsert");
    expect(addrUpsert?.paramsLength).toBe(2 * ADDR_COLS); // 2 rows (ethereum + base) for the one address
    expect(logs.some((l) => l.includes("addresses: 2 upserted, 3 stale removed"))).toBe(true);
  });

  it("joins the stored chain_state row (migration 020) onto the address rows it snapshotted", async () => {
    writeDocs("new-sha", { a: doc("a", "A.1", "alpha") });
    writeAddrAtlas("new-sha", {
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA": {
        chain: "ethereum", chains: ["ethereum"], roles: [], aliases: [], expectedTokens: [],
      },
    });
    fakeDb.prevSha = "old-sha";
    // The flat snapshot shape the worker stores: mainnet-only, address keys lowercased.
    fakeDb.chainState = {
      block: "25741379",
      values: { "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { wards: "1" } },
    };

    await main({ runMigrations: noopMigrations, force: false });

    const addrUpsert = unsafeCalls.find((c) => c.kind === "addr-upsert")!;
    // chain_state is the 12th of the 14 addrCols (see ADDR_COLS above).
    const chainState = addrUpsert.params[11] as { block: number; wards: string };
    expect(chainState).toMatchObject({ block: 25741379, wards: "1" });
  });

  it("degrades to no chain_state (and still syncs) when the chain_state read fails", async () => {
    writeDocs("new-sha", { a: doc("a", "A.1", "alpha") });
    writeAddrAtlas("new-sha", {
      "0xccc": { chain: "ethereum", chains: ["ethereum"], roles: [], aliases: [], expectedTokens: [] },
    });
    fakeDb.prevSha = "old-sha";
    fakeDb.chainStateError = "relation \"chain_state\" does not exist";

    // captureLog() only patches console.log; the degradation notice is a warn.
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(" "));
    const { restore } = captureLog();
    try {
      await expect(main({ runMigrations: noopMigrations, force: false })).resolves.toBeUndefined();
    } finally {
      restore();
      console.warn = origWarn;
    }
    const addrUpsert = unsafeCalls.find((c) => c.kind === "addr-upsert")!;
    expect(addrUpsert.params[11]).toBeNull(); // chain_state column
    expect(warns.some((l) => l.includes("chain_state read failed"))).toBe(true);
  });

  it("tolerates a missing addresses.json (on-chain enrichment is optional — existsSync-gated, unlike the other 3 artifacts)", async () => {
    writeDocs("new-sha", { a: doc("a", "A.1", "alpha") });
    writeAddrAtlas("new-sha", {
      "0xbbb": { chain: "ethereum", chains: ["ethereum"], roles: [], entityLabel: undefined, aliases: [], expectedTokens: [] },
    });
    fakeDb.prevSha = "old-sha";
    // Deliberately do NOT write addresses.json in this dir.

    await expect(main({ runMigrations: noopMigrations, force: false })).resolves.toBeUndefined();
    const addrUpsert = unsafeCalls.find((c) => c.kind === "addr-upsert");
    expect(addrUpsert).toBeDefined(); // still upserted, just with no on-chain enrichment
  });

  it("runs migrations before reading docs.json — proven by writing docs.json only inside the fake runMigrations callback", async () => {
    fakeDb.prevSha = "same-sha";
    // docs.json/addresses.atlas.json do NOT exist yet at this point. If
    // main() ever reordered to read them before awaiting runMigrations(),
    // this would throw ENOENT instead of reaching "already current".
    let migrationsRan = false;
    const { logs, restore } = captureLog();
    try {
      await main({
        runMigrations: async () => {
          migrationsRan = true;
          writeDocs("same-sha", { a: doc("a", "A.1", "alpha") });
          writeAddrAtlas("same-sha", {});
          return [];
        },
        force: false,
      });
    } finally {
      restore();
    }
    expect(migrationsRan).toBe(true);
    expect(logs.some((l) => l.includes("already current"))).toBe(true);
  });
});
