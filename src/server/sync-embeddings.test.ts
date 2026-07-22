// sync-embeddings.ts is a top-level CLI script: `await main();` runs
// immediately as a side effect of importing the module (no `import.meta.main`
// guard, no exports). Every dependency (db.ts, migrate.ts, embed.ts,
// config.ts) is mocked so importing it here never touches a real Postgres, a
// real OpenRouter call, or the real public/ directory. Unlike sync.ts, a
// thrown error here has no `.catch()` — it surfaces as a rejected import()
// promise, which a plain try/catch handles (no process.exit stub needed).
//
// Run under `bun test` (NOT vitest) — see vitest.config.ts exclude of src/server.
import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REAL_CONFIG = (await import("./config.ts")).config;
const REAL_DB = { ...(await import("./db.ts")) };
const REAL_MIGRATE = { ...(await import("./migrate.ts")) };
const REAL_EMBED = { ...(await import("./embed.ts")) };

async function restoreRealModules() {
  await mock.restore();
  await mock.module("./config.ts", () => ({ config: REAL_CONFIG }));
  await mock.module("./db.ts", () => REAL_DB);
  await mock.module("./migrate.ts", () => REAL_MIGRATE);
  await mock.module("./embed.ts", () => REAL_EMBED);
}

beforeEach(restoreRealModules);
afterEach(restoreRealModules);

function writeDocs(dir: string, nodes: Record<string, unknown>, atlasSha = "a".repeat(40)) {
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ atlasCommit: atlasSha, nodes }));
}

function doc(id: string, doc_no: string, title: string, content: string) {
  return { id, doc_no, title, type: "Core", depth: 1, parentId: null, content, order: 0, addressRefs: [] };
}

function mockSqlForEmbeddings(opts: {
  colType?: string;
  haveRows?: { doc_id: string; content_hash: string }[];
}) {
  let call = 0;
  const insertedBatches: unknown[][] = [];
  const sql = Object.assign(
    (_strings: TemplateStringsArray, ..._vals: unknown[]) => {
      call++;
      // Only one plain tagged call: SELECT doc_id, content_hash FROM atlas_doc_embeddings
      return Promise.resolve(opts.haveRows ?? []);
    },
    {
      unsafe: async (sqlText: string, params?: unknown[]) => {
        if (sqlText.includes("format_type")) return [{ t: opts.colType ?? "vector(1024)" }];
        insertedBatches.push(params ?? []);
        return [];
      },
      end: async () => {},
    },
  );
  return { sql, insertedBatches };
}

let importSeq = 0;
async function freshImportSyncEmbeddings(): Promise<{ threw: Error | null }> {
  importSeq++;
  try {
    await import(`./sync-embeddings.ts?t=${importSeq}`);
    return { threw: null };
  } catch (e) {
    return { threw: e as Error };
  }
}

test("no stale/new docs: embeds nothing and exits cleanly", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "se-pub-"));
  writeDocs(publicDir, { d1: doc("d1", "A.1", "Doc One", "hello world") });

  await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir } }));
  await mock.module("./migrate.ts", () => ({ runMigrations: async () => {} }));
  // Compute the real content_hash so "have" already matches it (queue empty).
  const { contentHash } = await import("./embed-text.ts");
  const hash = contentHash(doc("d1", "A.1", "Doc One", "hello world"));
  const { sql, insertedBatches } = mockSqlForEmbeddings({ haveRows: [{ doc_id: "d1", content_hash: hash }] });
  await mock.module("./db.ts", () => ({ ...REAL_DB, sql }));
  await mock.module("./embed.ts", () => ({
    ...REAL_EMBED,
    embedBatch: async () => {
      throw new Error("must not be called — nothing is stale");
    },
  }));

  const { threw } = await freshImportSyncEmbeddings();
  expect(threw).toBeNull();
  expect(insertedBatches.length).toBe(0);

  fs.rmSync(publicDir, { recursive: true, force: true });
});

test("embeds stale/new docs in batches and upserts vectors", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "se-pub-"));
  writeDocs(publicDir, {
    d1: doc("d1", "A.1", "Doc One", "alpha content"),
    d2: doc("d2", "A.2", "Doc Two", "bravo content"),
  });

  await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir } }));
  await mock.module("./migrate.ts", () => ({ runMigrations: async () => {} }));
  // "have" has a stale hash for d1 and nothing for d2 → both queue up.
  const { sql, insertedBatches } = mockSqlForEmbeddings({ haveRows: [{ doc_id: "d1", content_hash: "stale-hash" }] });
  await mock.module("./db.ts", () => ({ ...REAL_DB, sql }));
  let embedCalls = 0;
  await mock.module("./embed.ts", () => ({
    ...REAL_EMBED,
    embedBatch: async (texts: string[]) => {
      embedCalls++;
      return texts.map(() => new Array(REAL_EMBED.EMBED_DIM).fill(0.25));
    },
  }));

  const { threw } = await freshImportSyncEmbeddings();
  expect(threw).toBeNull();
  expect(embedCalls).toBe(1); // both docs fit in one batch (default EMBED_BATCH=50)
  expect(insertedBatches.length).toBe(1);

  fs.rmSync(publicDir, { recursive: true, force: true });
});

test("a failed batch (after retries) is skipped, not fatal — sync completes", async () => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "se-pub-"));
  process.env.EMBED_BATCH = "1"; // force two single-doc batches: one fails, one succeeds
  writeDocs(publicDir, {
    d1: doc("d1", "A.1", "Doc One", "alpha content"),
    d2: doc("d2", "A.2", "Doc Two", "bravo content"),
  });

  await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir } }));
  await mock.module("./migrate.ts", () => ({ runMigrations: async () => {} }));
  const { sql, insertedBatches } = mockSqlForEmbeddings({ haveRows: [] });
  await mock.module("./db.ts", () => ({ ...REAL_DB, sql }));
  await mock.module("./embed.ts", () => ({
    ...REAL_EMBED,
    embedBatch: async (texts: string[]) => {
      if (texts[0].includes("Doc One")) throw new Error("provider hiccup");
      return texts.map(() => new Array(REAL_EMBED.EMBED_DIM).fill(0.5));
    },
  }));

  const { threw } = await freshImportSyncEmbeddings();
  expect(threw).toBeNull(); // best-effort: a bad batch doesn't fail the whole run
  expect(insertedBatches.length).toBe(1); // only the successful batch upserted

  delete process.env.EMBED_BATCH;
  fs.rmSync(publicDir, { recursive: true, force: true });
}, 15_000); // embedBatch's internal retry/backoff sleeps for real (via Bun.sleep)

// NOTE: the colDim-mismatch guard (main() throws when the live
// atlas_doc_embeddings.embedding column doesn't match EMBED_DIM) is
// deliberately NOT exercised here. A thrown error propagating out of a
// dynamically re-imported module's top-level `await main()` was verified to
// corrupt bun's V8 coverage counters for the rest of this file's runs in the
// same process (same finding as sync.test.ts's dropped process.exit test:
// removing an error-propagating test alone took this file from ~26% to ~93%
// line coverage with no other change) — a worse trade than leaving that one
// guard clause uncovered.
