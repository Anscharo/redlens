// atlas_onchain: the stored on-chain facts filtered by entity, chain, kind,
// address and words, with how far each deployment has been read. The question
// "what is set on-chain" is answered from the chain side, so it also lists what
// the atlas never mentions.
import type { ToolResult } from "../chat/tools/tools.ts";
import { resolveEntity } from "../retrieval/entity-resolve.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { ONCHAIN_SOURCES } from "./sources.ts";
import { factIndex, factOutput, SOURCES_FAILED_NOTE, type OnchainFact } from "./facts.ts";

export interface OnchainQuery {
  entity?: string;
  chain?: string;
  kind?: string;
  address?: string;
  query?: string;
  include_off?: boolean;
  limit: number;
}

// A reader asking for "deposit" limits means the atlas's "Inflow" ones too.
const ALIASES: [RegExp, string][] = [
  [/\binflow\b/i, "deposit supply"],
  [/\boutflow\b/i, "withdraw withdrawal redeem"],
];

function haystack(f: OnchainFact): string {
  const text = [f.name, f.entity, f.chain, f.kind, JSON.stringify(f.values)].join(" ");
  return [text, ...ALIASES.filter(([re]) => re.test(text)).map(([, add]) => add)].join(" ").toLowerCase();
}

/** A chain the reader named, full ("ethereum"), abbreviated ("eth") or qualified ("ethereum mainnet"). */
export function sameChain(chain: string, asked: string | undefined): boolean {
  const a = (asked ?? "").trim().toLowerCase();
  return !a || chain.startsWith(a) || a.startsWith(chain);
}

function matches(f: OnchainFact, q: OnchainQuery, entityId: string | null, words: string[]): boolean {
  if (entityId && f.entity_id !== entityId) return false;
  if (!sameChain(f.chain, q.chain)) return false;
  if (q.kind && f.kind !== q.kind) return false;
  if (q.address && !f.match.addresses.includes(q.address.toLowerCase())) return false;
  if (!q.include_off && f.values.switched_off === true) return false;
  const hay = haystack(f);
  return words.every((w) => hay.includes(w));
}

const order = (a: OnchainFact, b: OnchainFact) =>
  a.entity.localeCompare(b.entity) || a.chain.localeCompare(b.chain) || a.kind.localeCompare(b.kind) || (a.name ?? "~").localeCompare(b.name ?? "~");

export async function onchainState(ix: Indexes, q: OnchainQuery): Promise<ToolResult> {
  const ent = q.entity ? resolveEntity(ix, q.entity) : null;
  if (q.entity && !ent) return { error: `No entity matches '${q.entity}'. Use atlas_entities to find its slug.` };
  const idx = await factIndex(ix);
  const words = (q.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const facts = idx.facts.filter((f) => matches(f, q, ent?.id ?? null, words)).sort(order);
  const limit = Math.min(Math.max(1, q.limit || 50), 200);
  const coverage = idx.coverage.filter((c) => (!ent || c.entity_id === ent.id) && sameChain(c.chain, q.chain));
  return {
    sources: ONCHAIN_SOURCES.map((s) => ({ id: s.id, describe: s.describe })),
    ...(idx.failed.length ? { sources_failed: idx.failed, sources_failed_note: SOURCES_FAILED_NOTE } : {}),
    coverage,
    count: facts.length,
    ...(facts.length > limit ? { truncated: true } : {}),
    facts: facts.slice(0, limit).map(factOutput),
  };
}
