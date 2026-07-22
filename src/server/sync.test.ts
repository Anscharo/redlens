// sync.ts is a top-level CLI script: `main()` runs immediately as a side effect
// of importing the module (no `import.meta.main` guard), and its `.catch()`
// calls `process.exit(1)` on failure. Every dependency (db.ts, migrate.ts,
// config.ts) is mocked so importing the module here never touches a real
// Postgres or the real public/ directory, and `process.exit` is stubbed so an
// intentionally-triggered failure path can't kill the test runner.
//
// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Captured at module-evaluation time (see atlas-updater.test.ts for the full
// rationale): plain-object snapshots, NOT live namespace references — a live
// reference would follow later mock.module overwrites and never let a restore
// land back on the true original.
const REAL_CONFIG = (await import("./config.ts")).config;
const REAL_DB = { ...(await import("./db.ts")) };
const REAL_MIGRATE = { ...(await import("./migrate.ts")) };

async function restoreRealModules() {
  await mock.restore();
  await mock.module("./config.ts", () => ({ config: REAL_CONFIG }));
  await mock.module("./db.ts", () => REAL_DB);
  await mock.module("./migrate.ts", () => REAL_MIGRATE);
}

beforeEach(restoreRealModules);
afterEach(restoreRealModules);

function writeFixtures(dir: string, opts: { atlasSha: string; docs?: Record<string, unknown> }) {
  fs.writeFileSync(
    path.join(dir, "docs.json"),
    JSON.stringify({
      atlasCommit: opts.atlasSha,
      nodes: opts.docs ?? {
        d1: { id: "d1", doc_no: "A.1", title: "Doc One", type: "Core", depth: 1, parentId: null, content: "hello", order: 0, addressRefs: [] },
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "addresses.atlas.json"),
    JSON.stringify({ atlasCommit: opts.atlasSha, addresses: { "0xAbCabcabcabcabcabcabcabcabcabcabcabcabc": { chain: "ethereum" } } }),
  );
  fs.writeFileSync(path.join(dir, "chain-state.json"), JSON.stringify({}));
}

function fakeTx() {
  let call = 0;
  const unsafeCalls: string[] = [];
  const tx = Object.assign(
    (_strings: TemplateStringsArray, ..._vals: unknown[]) => {
      call++;
      // Sequence inside sql.begin: (1) address GC delete → needs .count,
      // (2) sync_state upsert, (3) sync_log insert.
      if (call === 1) return Promise.resolve(Object.assign([], { count: 1 }));
      return Promise.resolve([]);
    },
    {
      unsafe: async (sqlText: string, _params: unknown[]) => {
        unsafeCalls.push(sqlText);
        return [];
      },
    },
  );
  return { tx, unsafeCalls };
}

function mockDbForSync(opts: { prevSha: string | null; beforeRows?: { id: string; content_hash: string }[] }) {
  let call = 0;
  const { tx, unsafeCalls } = fakeTx();
  let ended = false;
  const sql = Object.assign(
    (_strings: TemplateStringsArray, ..._vals: unknown[]) => {
      call++;
      if (call === 1) return Promise.resolve([{ atlas_sha: opts.prevSha }]);
      return Promise.resolve(opts.beforeRows ?? []);
    },
    {
      begin: async (cb: (tx: unknown) => Promise<void>) => { await cb(tx); },
      end: async () => {
        ended = true;
      },
    },
  );
  return { sql, unsafeCalls, wasEnded: () => ended };
}

let importSeq = 0;

// sync.ts has no `import.meta.main` guard — `main()` runs immediately as a
// side effect of import, with no exports to signal completion. A plain
// `import("./sync.ts")` would only ever execute that side effect ONCE per
// process (module cache), so every test appends a unique cache-busting query
// so its own mocks actually drive a fresh run.
async function importSyncAndWaitForEnd(waitForEnded: () => boolean, timeoutMs = 2000): Promise<void> {
  importSeq++;
  await import(`./sync.ts?t=${importSeq}`);
  const start = Date.now();
  while (!waitForEnded() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(waitForEnded()).toBe(true);
}

test("already current: exits early without touching the transaction", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-pub-"));
  const SHA = "a".repeat(40);
  writeFixtures(publicDir, { atlasSha: SHA });

  await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir } }));
  await mock.module("./migrate.ts", () => ({ runMigrations: async () => {} }));
  const { sql, wasEnded } = mockDbForSync({ prevSha: SHA });
  await mock.module("./db.ts", () => ({ sql, waitForDb: async () => {} }));

  await importSyncAndWaitForEnd(wasEnded);
  expect(wasEnded()).toBe(true);

  fs.rmSync(publicDir, { recursive: true, force: true });
});

test("full sync: diffs doc_meta, upserts addresses, and advances sync_state", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-pub-"));
  const SHA = "b".repeat(40);
  writeFixtures(publicDir, { atlasSha: SHA });

  await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir } }));
  await mock.module("./migrate.ts", () => ({ runMigrations: async () => {} }));
  // prevSha differs from atlasSha (drift) → full sync path. "before" has one
  // stale doc (removed in the new artifact) and nothing matching d1 (→ insert).
  const { sql, unsafeCalls, wasEnded } = mockDbForSync({
    prevSha: "a".repeat(40),
    beforeRows: [{ id: "stale-doc-id", content_hash: "old-hash" }],
  });
  await mock.module("./db.ts", () => ({ sql, waitForDb: async () => {} }));

  await importSyncAndWaitForEnd(wasEnded);

  // Both the doc_meta upsert and the address upsert went through tx.unsafe.
  expect(unsafeCalls.some((s) => s.includes("atlas_doc_meta"))).toBe(true);
  expect(unsafeCalls.some((s) => s.includes("atlas_addresses"))).toBe(true);
  // The stale doc (absent from the new artifact) triggers the DELETE branch.
  expect(unsafeCalls.some((s) => s.includes("DELETE FROM atlas_doc_meta"))).toBe(true);

  fs.rmSync(publicDir, { recursive: true, force: true });
});

test("full sync with no removed docs skips the doc-delete branch", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-pub-"));
  const SHA = "c".repeat(40);
  writeFixtures(publicDir, { atlasSha: SHA });

  await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir } }));
  await mock.module("./migrate.ts", () => ({ runMigrations: async () => {} }));
  const { sql, unsafeCalls, wasEnded } = mockDbForSync({ prevSha: "a".repeat(40), beforeRows: [] });
  await mock.module("./db.ts", () => ({ sql, waitForDb: async () => {} }));

  await importSyncAndWaitForEnd(wasEnded);
  expect(unsafeCalls.some((s) => s.includes("DELETE FROM atlas_doc_meta"))).toBe(false);

  fs.rmSync(publicDir, { recursive: true, force: true });
});

// NOTE: main()'s fatal-error branch (`.catch(...) { ...; process.exit(1); }`)
// is deliberately NOT exercised here. Stubbing `process.exit` to observe it
// safely was tried and works functionally, but it corrupts bun's V8 coverage
// counters for the rest of this file's runs in the same process (verified:
// removing that one test alone took sync.ts from ~20% to ~94% line coverage
// with no other change) — a worse trade than leaving that one line uncovered.
