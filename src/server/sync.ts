// sync:atlas — write the structural Postgres tables from build artifacts.
// Fast, transactional, sha-gated. Embeddings are a SEPARATE lane (sync:embeddings)
// so a slow/failing embed provider never blocks structural sync.
//
//   bun src/server/sync.ts            # sha-gated: skips if already current
//   bun src/server/sync.ts --force    # sync regardless of sha
//
// Reads: public/{docs,addresses.atlas,addresses}.json + the chain_state row
// (migration 020 — the on-chain snapshot is DB-resident, not a file, since the
// atlas worker took over fetching it).
// History is written by build-history.mjs (DB sink) in the worker, not here.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sql, waitForDb, toUuidArrayLiteral } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { readChainState } from "./chain-state.ts";
import type { AtlasNode } from "./retrieval/indexes.ts";
import { nodeToDocRow, buildChainStateByAddr, buildAddrRows } from "./retrieval/doc-rows.ts";

// Exported (not just a module-level constant) so a test can drive both branches
// of the --force gate without needing a literal `--force` in the test runner's
// own argv. Behavior at the real call site is unchanged: realSyncDeps below
// still reads it from process.argv exactly once, at import time, same as before.
export function forceFromArgv(argv: string[] = process.argv): boolean {
  return argv.includes("--force");
}
export const pub = (f: string) => join(config.publicDir, f);
export const readJson = <T>(f: string): T => JSON.parse(readFileSync(pub(f), "utf8")) as T;

export async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

// Injected so main() is testable without a real Postgres connection or a
// literal --force argv — mirrors preview/build.ts's BuildDeps/realBuildDeps.
// `sql` itself deliberately stays OUT of this seam and a direct top-of-file
// import: every DB-touching *.test.ts in this codebase fakes it via
// mock.module("./db.ts", …) instead (see db.test.ts / migrate.test.ts), so
// sync.ts keeps that same convention rather than inventing a second one.
export interface SyncDeps {
  runMigrations: () => Promise<string[]>;
  force: boolean;
}
const realSyncDeps: SyncDeps = { runMigrations, force: forceFromArgv() };

export async function main(deps: SyncDeps = realSyncDeps) {
  const startedAt = new Date();
  console.log("sync:atlas — waiting for db…");
  await waitForDb(); // tolerate Railway's private-network / fresh-PG boot lag
  console.log("sync:atlas — running migrations…");
  await deps.runMigrations();

  console.log("sync:atlas — reading docs.json…");
  const docsFile = readJson<{ atlasCommit?: string; nodes: Record<string, AtlasNode> }>("docs.json");
  const atlasSha = docsFile.atlasCommit ?? "unknown";
  console.log(`sync:atlas — docs.json: ${Object.keys(docsFile.nodes).length} nodes, atlasCommit=${atlasSha.slice(0, 12)}`);

  const prevState = await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`;
  const prevSha: string | null = prevState[0]?.atlas_sha ?? null;
  if (!deps.force && prevSha === atlasSha) {
    console.log(`sync:atlas — already current at ${atlasSha.slice(0, 12)} (use --force to re-sync)`);
    await sql.end();
    return;
  }
  console.log(`sync:atlas — ${prevSha?.slice(0, 12) ?? "(empty)"} → ${atlasSha.slice(0, 12)}`);

  // ── doc_meta ──────────────────────────────────────────────────────────────
  const docs = Object.values(docsFile.nodes);
  const docRows = docs.map((d) => nodeToDocRow(d, atlasSha));

  // Diff against current rows for accurate ledger counts + stale deletion.
  const before = new Map<string, string>(
    (await sql`SELECT id, content_hash FROM atlas_doc_meta`).map(
      (r: { id: string; content_hash: string }) => [r.id, r.content_hash],
    ),
  );
  const newIds = new Set(docRows.map((r) => r.id));
  let inserted = 0, updated = 0;
  for (const r of docRows) {
    if (!before.has(r.id)) inserted++;
    else if (before.get(r.id) !== r.content_hash) updated++;
  }
  const removedDocIds = [...before.keys()].filter((id) => !newIds.has(id));

  // ── addresses (build rows; written inside the txn below) ─────────────────────
  const addrAtlas = readJson<{ atlasCommit?: string; addresses?: Record<string, {
    chain?: string; chains?: string[]; roles?: string[]; entityLabel?: string; aliases?: string[]; expectedTokens?: string[];
  }> }>("addresses.atlas.json").addresses ?? {};
  const addrOnChain = existsSync(pub("addresses.json"))
    ? readJson<Record<string, { chainlogId?: string; etherscanName?: string; isContract?: boolean; codeByChain?: Record<string, boolean>; presentOnChains?: string[]; isProxy?: boolean; implementation?: string }>>("addresses.json")
    : {};
  // The chain-state snapshot lives in Postgres (migration 020), written by the
  // atlas worker's time-gated step — it used to be public/chain-state.json.
  // Read it here so atlas_addresses.chain_state keeps its meaning; a missing row
  // (fresh DB, or a dev box that never ran `pnpm snap:chainstate`) or a read
  // failure degrades to no chain_state rather than aborting the whole sync.
  // Snapshot freshness in atlas_addresses is therefore bounded by the ATLAS
  // sync cadence, not the snapshot cadence — see the note in chain-state.ts.
  const stored = await readChainState().catch((e: Error) => {
    console.warn(`sync:atlas — chain_state read failed (${e.message}) — continuing without on-chain values`);
    return null;
  });
  const chainStateByAddr = buildChainStateByAddr(
    stored ? { block: Number(stored.block) || undefined, values: stored.values } : {},
  );
  const addrRows = buildAddrRows(addrAtlas, addrOnChain, chainStateByAddr, atlasSha);

  // jsonb columns need an explicit ::jsonb cast on the placeholder — the values
  // are JSON strings, which Postgres won't implicitly coerce to jsonb.
  const addrCols = [
    "address", "chain", "label", "chainlog_id", "etherscan_name", "is_contract", "is_proxy",
    "implementation", "roles", "aliases", "expected_tokens", "chain_state",
    "content_hash", "atlas_sha",
  ];
  const JSONB_COLS = new Set(["roles", "aliases", "expected_tokens", "chain_state"]);
  const setClause = addrCols
    .filter((c) => c !== "address" && c !== "chain")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");

  // ── one transaction: PG never holds a half-updated structural snapshot, and
  //    the sync_state pointer only advances if every table committed. ─────────
  let addrDeleted = 0;
  await sql.begin(async (tx) => {
    // Manual placeholders (not the ${tx(chunk, cols)} bulk helper): address_refs
    // is a jsonb string[] and needs an explicit ::jsonb cast, exactly like the
    // address roles/aliases below. The bulk helper can't cast per-column and
    // mis-encodes a JS array (empty [] → "" → "malformed array literal").
    const docCols = [
      "id", "doc_no", "title", "type", "depth", "ord", "parent_id",
      "content_hash", "node_content_hash", "address_refs", "atlas_sha", "content",
    ];
    const DOC_JSONB_COLS = new Set(["address_refs"]);
    const docSet = docCols
      .filter((c) => c !== "id")
      .map((c) => `${c} = excluded.${c}`)
      .join(", ");
    await chunked(docRows, 3000, async (chunk) => {
      const params: unknown[] = [];
      const valuesSql = chunk
        .map((row) => {
          const ph = docCols.map((c) => {
            params.push((row as unknown as Record<string, unknown>)[c]);
            return DOC_JSONB_COLS.has(c) ? `$${params.length}::jsonb` : `$${params.length}`;
          });
          return `(${ph.join(",")})`;
        })
        .join(",");
      await tx.unsafe(
        `INSERT INTO atlas_doc_meta (${docCols.join(",")}) VALUES ${valuesSql}
         ON CONFLICT (id) DO UPDATE SET ${docSet}`,
        params,
      );
    });
    if (removedDocIds.length) {
      await chunked(removedDocIds, 5000, async (chunk) => {
        await tx.unsafe(`DELETE FROM atlas_doc_meta WHERE id = ANY($1::uuid[])`, [toUuidArrayLiteral(chunk)]);
      });
    }
    await chunked(addrRows, 1000, async (chunk) => {
      const params: unknown[] = [];
      const valuesSql = chunk
        .map((row) => {
          const ph = addrCols.map((c) => {
            params.push((row as unknown as Record<string, unknown>)[c]);
            return JSONB_COLS.has(c) ? `$${params.length}::jsonb` : `$${params.length}`;
          });
          return `(${ph.join(",")})`;
        })
        .join(",");
      await tx.unsafe(
        `INSERT INTO atlas_addresses (${addrCols.join(",")}) VALUES ${valuesSql}
         ON CONFLICT (address, chain) DO UPDATE SET ${setClause}`,
        params,
      );
    });
    // Address GC. sync had no address-deletion step, so any (address, chain) the
    // current artifact no longer contains lingered forever — notably the stale
    // LOWERCASED Solana rows written before the casing fix (the case-corrected
    // rows land under a new PK, leaving the old ones orphaned). Every current
    // address was just stamped atlas_sha = current by the upsert above, so
    // anything still carrying an older sha is stale. Drift-driven syncs always
    // advance the sha, so this never deletes live rows.
    const addrDel = await tx`DELETE FROM atlas_addresses WHERE atlas_sha <> ${atlasSha}`;
    addrDeleted = addrDel.count ?? 0;
    await tx`
      INSERT INTO sync_state (id, atlas_sha, synced_at) VALUES (1, ${atlasSha}, now())
      ON CONFLICT (id) DO UPDATE SET atlas_sha = excluded.atlas_sha, synced_at = now()
    `;
    await tx`
      INSERT INTO sync_log (atlas_sha, prev_sha, inserted, updated, deleted, started_at, finished_at)
      VALUES (${atlasSha}, ${prevSha}, ${inserted}, ${updated}, ${removedDocIds.length}, ${startedAt}, now())
    `;
  });

  console.log(`  doc_meta: ${inserted} inserted, ${updated} updated, ${removedDocIds.length} removed`);
  console.log(`  addresses: ${addrRows.length} upserted, ${addrDeleted} stale removed`);
  console.log(`sync:atlas — done (atlas ${atlasSha.slice(0, 12)})`);
  await sql.end();
}

// Only run when launched directly (`bun src/server/sync.ts`) — every caller
// (package.json sync:atlas, atlas-worker.mjs, atlas-updater.ts's boot-embeddings
// spawn, index.ts's post-preview-build spawn) shells out to this file as a
// subprocess rather than importing it, but without this guard a plain
// `import "./sync.ts"` (e.g. from a test) would kick off a real DB sync as a
// side effect of module load. import.meta.main is only ever true for a real
// `bun src/server/sync.ts` run, never for a module loaded by `bun test` — so
// this catch handler (the fatal-error → process.exit(1) path) has no unit-test
// technique that can execute it; main() itself is exercised directly and
// thoroughly in sync.test.ts.
/* v8 ignore start -- boot-only; see the comment above */
if (import.meta.main) {
  main().catch((err) => {
    console.error("sync:atlas — fatal error:", err?.message ?? err);
    console.error(err?.stack ?? "");
    process.exit(1);
  });
}
/* v8 ignore stop */
