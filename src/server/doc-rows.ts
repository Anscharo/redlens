// Pure builders for the atlas_doc_meta / atlas_addresses write rows.
//
// Extracted from sync.ts's main() so the row shapes are unit-testable without a
// DB, and so the DB round-trip contract with the in-process updater
// (docRowToNode in indexes.ts) is pinned by tests. Two hashes live on a doc row
// and MUST NOT be confused:
//   - content_hash      = embed-text hash sha256(title+content); the sync diff
//                         ledger's change signal.
//   - node_content_hash = the parser's sha256(raw markdown slice) carried on the
//                         node as `contentHash`; OEA freshness keys on THIS one,
//                         so it needs its own column to survive the DB round-trip.
// address_refs is persisted (not re-derived) so the updater rebuild doesn't drift
// from build-index's extraction — the reason RightPanel address cards vanished
// after the first hot refresh.
import { normalizeAddress } from "../../scripts/lib/address-chains.mjs";
import { contentHash as embedContentHash } from "./embed-text.ts";
import type { AtlasNode } from "./indexes.ts";

export interface DocMetaWriteRow {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  ord: number;
  parent_id: string | null;
  content_hash: string; // embed-text hash — sync diff ledger
  node_content_hash: string | null; // parser sha256(raw) — OEA freshness
  address_refs: string[]; // per-node normalized address keys
  atlas_sha: string;
  content: string;
}

export function nodeToDocRow(d: AtlasNode, atlasSha: string): DocMetaWriteRow {
  return {
    id: d.id,
    doc_no: d.doc_no,
    title: d.title,
    type: d.type,
    depth: d.depth ?? 0,
    ord: d.order ?? 0,
    parent_id: d.parentId ?? null,
    content_hash: embedContentHash(d),
    node_content_hash: d.contentHash ?? null,
    address_refs: d.addressRefs ?? [],
    atlas_sha: atlasSha,
    content: d.content ?? "",
  };
}

// ── addresses ────────────────────────────────────────────────────────────────

export interface ChainStateEntry {
  block: number | null;
  values: unknown;
}

interface ChainStateRaw {
  chains?: Record<string, { block?: number; slot?: number; values?: Record<string, unknown> }>;
  block?: number;
  values?: Record<string, unknown>;
}

// Key chain-state by the CANONICAL address (EVM lowercased, Solana left as-is)
// so the address-row join lands. Lowercasing base58 corrupts Solana keys.
export function buildChainStateByAddr(raw: ChainStateRaw): Record<string, ChainStateEntry> {
  const out: Record<string, ChainStateEntry> = {};
  if (raw.chains) {
    for (const data of Object.values(raw.chains)) {
      for (const [addr, values] of Object.entries(data.values ?? {})) {
        out[normalizeAddress(addr)] = { block: data.block ?? data.slot ?? null, values };
      }
    }
  } else {
    for (const [addr, values] of Object.entries(raw.values ?? {})) {
      out[normalizeAddress(addr)] = { block: raw.block ?? null, values };
    }
  }
  return out;
}

interface AddrAtlasEntry {
  chain?: string;
  roles?: string[];
  entityLabel?: string;
  aliases?: string[];
  expectedTokens?: string[];
}
interface AddrOnChainEntry {
  chainlogId?: string;
  etherscanName?: string;
  isContract?: boolean;
  isProxy?: boolean;
  implementation?: string;
}

export interface AddrWriteRow {
  address: string;
  chain: string;
  label: string | null;
  chainlog_id: string | null;
  etherscan_name: string | null;
  is_contract: boolean;
  is_proxy: boolean;
  implementation: string | null;
  roles: string[];
  aliases: string[];
  expected_tokens: string[];
  chain_state: Record<string, unknown> | null;
  atlas_sha: string;
  content_hash: string;
}

// Build the atlas_addresses upsert rows. Addresses are normalized (EVM → lower,
// Solana untouched) and deduped by (address, chain): two artifact keys that
// differ only in EVM case would otherwise collide on the (address, chain) PK and
// roll back the whole structural sync ("cannot affect row a second time").
export function buildAddrRows(
  addrAtlas: Record<string, AddrAtlasEntry>,
  addrOnChain: Record<string, AddrOnChainEntry>,
  chainStateByAddr: Record<string, ChainStateEntry>,
  atlasSha: string,
): AddrWriteRow[] {
  const byKey = new Map<string, AddrWriteRow>();
  for (const [addr, a] of Object.entries(addrAtlas)) {
    const norm = normalizeAddress(addr);
    const oc = addrOnChain[addr] ?? addrOnChain[norm] ?? {};
    const label = oc.chainlogId ?? a.entityLabel ?? oc.etherscanName ?? null;
    const chain = a.chain ?? "ethereum";
    const cs = chainStateByAddr[norm];
    const record = {
      address: norm,
      chain,
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
      // Snapshot block lives inside the JSONB as chain_state->>'block'.
      chain_state: cs ? { block: cs.block, ...(cs.values as Record<string, unknown>) } : null,
      atlas_sha: atlasSha,
    };
    byKey.set(`${norm}:${chain}`, { ...record, content_hash: Bun.hash(JSON.stringify(record)).toString(16) });
  }
  return [...byKey.values()];
}
