// sync:atlas — write the structural Postgres tables from build artifacts.
// Fast, transactional, sha-gated. Embeddings are a SEPARATE lane (sync:embeddings)
// so a slow/failing embed provider never blocks structural sync.
//
//   bun src/server/sync.ts            # sha-gated: skips if already current
//   bun src/server/sync.ts --force    # sync regardless of sha
//
// Reads: public/{docs,addresses.atlas,addresses,chain-state}.json
// History is synced by the history worker (sync-history-pg.ts), not here.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sql, waitForDb } from "./db.ts";
import { config } from "./config.ts";
import { runMigrations } from "./migrate.ts";
import { contentHash } from "./embed-text.ts";
import type { AtlasNode } from "./indexes.ts";

const FORCE = process.argv.includes("--force");
const pub = (f: string) => join(config.publicDir, f);
const readJson = <T>(f: string): T => JSON.parse(readFileSync(pub(f), "utf8")) as T;

interface DocMetaRow {
  id: string; doc_no: string; title: string; type: string;
  depth: number; ord: number; parent_id: string | null; content_hash: string; atlas_sha: string;
  content: string;
  [k: string]: unknown;
}

async function chunked<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function main() {
  const startedAt = new Date();
  await waitForDb(); // tolerate Railway's private-network / fresh-PG boot lag
  await runMigrations();

  const docsFile = readJson<{ atlasCommit?: string; nodes: Record<string, AtlasNode> }>("docs.json");
  const atlasSha = docsFile.atlasCommit ?? "unknown";

  const prevState = await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`;
  const prevSha: string | null = prevState[0]?.atlas_sha ?? null;
  if (!FORCE && prevSha === atlasSha) {
    console.log(`sync:atlas — already current at ${atlasSha.slice(0, 12)} (use --force to re-sync)`);
    await sql.end();
    return;
  }
  console.log(`sync:atlas — ${prevSha?.slice(0, 12) ?? "(empty)"} → ${atlasSha.slice(0, 12)}`);

  // ── doc_meta ──────────────────────────────────────────────────────────────
  const docs = Object.values(docsFile.nodes);
  const docRows: DocMetaRow[] = docs.map((d) => ({
    id: d.id,
    doc_no: d.doc_no,
    title: d.title,
    type: d.type,
    depth: d.depth ?? 0,
    ord: d.order ?? 0,
    parent_id: d.parentId ?? null,
    content_hash: contentHash(d),
    atlas_sha: atlasSha,
    content: d.content ?? "",
  }));

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
  const addrAtlas = readJson<{ atlasCommit?: string; addresses: Record<string, {
    chain?: string; roles?: string[]; entityLabel?: string; aliases?: string[]; expectedTokens?: string[];
  }> }>("addresses.atlas.json").addresses;
  const addrOnChain = existsSync(pub("addresses.json"))
    ? readJson<Record<string, { chainlogId?: string; etherscanName?: string; isContract?: boolean; isProxy?: boolean; implementation?: string }>>("addresses.json")
    : {};
  const chainStateRaw = readJson<{ chains?: Record<string, { block?: number; slot?: number; values?: Record<string, unknown> }>; block?: number; values?: Record<string, unknown> }>("chain-state.json");
  const chainStateByAddr: Record<string, { block: number | null; values: unknown }> = {};
  if (chainStateRaw.chains) {
    for (const data of Object.values(chainStateRaw.chains)) {
      for (const [addr, values] of Object.entries(data.values ?? {})) {
        chainStateByAddr[addr.toLowerCase()] = { block: data.block ?? data.slot ?? null, values };
      }
    }
  } else {
    for (const [addr, values] of Object.entries(chainStateRaw.values ?? {})) {
      chainStateByAddr[addr.toLowerCase()] = { block: chainStateRaw.block ?? null, values };
    }
  }

  const addrRows = Object.entries(addrAtlas).map(([addr, a]) => {
    const oc = addrOnChain[addr] ?? {};
    const label = oc.chainlogId ?? a.entityLabel ?? oc.etherscanName ?? null;
    const cs = chainStateByAddr[addr.toLowerCase()];
    const record = {
      address: addr.toLowerCase(),
      chain: a.chain ?? "ethereum",
      label,
      chainlog_id: oc.chainlogId ?? null,
      etherscan_name: oc.etherscanName ?? null,
      is_contract: !!oc.isContract,
      is_proxy: !!oc.isProxy,
      implementation: oc.implementation ?? null,
      // Raw JS values: Bun.sql infers jsonb from the ::jsonb cast and encodes
      // once. Pre-stringifying here double-encodes (stores a JSON string).
      roles: a.roles ?? [],
      aliases: a.aliases ?? [],
      expected_tokens: a.expectedTokens ?? [],
      // Snapshot block lives inside the JSONB as chain_state->>'block' (no
      // separate column) — merge the per-chain block in alongside the view-fns.
      chain_state: cs ? { block: cs.block, ...(cs.values as Record<string, unknown>) } : null,
      atlas_sha: atlasSha,
    };
    return { ...record, content_hash: Bun.hash(JSON.stringify(record)).toString(16) };
  });

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
  await sql.begin(async (tx) => {
    await chunked(docRows, 3000, async (chunk) => {
      await tx`
        INSERT INTO atlas_doc_meta ${tx(chunk as unknown as Record<PropertyKey, unknown>[], "id", "doc_no", "title", "type", "depth", "ord", "parent_id", "content_hash", "atlas_sha", "content")}
        ON CONFLICT (id) DO UPDATE SET
          doc_no = excluded.doc_no, title = excluded.title, type = excluded.type,
          depth = excluded.depth, ord = excluded.ord, parent_id = excluded.parent_id,
          content_hash = excluded.content_hash, atlas_sha = excluded.atlas_sha,
          content = excluded.content
      `;
    });
    if (removedDocIds.length) {
      await chunked(removedDocIds, 5000, async (chunk) => {
        await tx.unsafe(`DELETE FROM atlas_doc_meta WHERE id = ANY($1::uuid[])`, [chunk]);
      });
    }
    await chunked(addrRows, 1000, async (chunk) => {
      const params: unknown[] = [];
      const valuesSql = chunk
        .map((row) => {
          const ph = addrCols.map((c) => {
            params.push((row as Record<string, unknown>)[c]);
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
  console.log(`  addresses: ${addrRows.length} upserted`);
  console.log(`sync:atlas — done (atlas ${atlasSha.slice(0, 12)})`);
  await sql.end();
}

await main();
