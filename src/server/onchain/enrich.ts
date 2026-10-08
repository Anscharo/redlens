// The `onchain` block existing tools carry: every stored on-chain fact their
// result names by a key hash, an address or an atlas document id. A model
// reading an instance's RateLimitID and its atlas maxAmount then sees what the
// chain holds beside them without knowing a separate tool exists.
import type { AtlasHandler } from "../chat/tools/tool-types.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { factIndex, SOURCES_FAILED_NOTE, type FactIndex, type OnchainFact } from "./facts.ts";

const MAX_FACTS = 15;
const HASH_RE = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const ONCHAIN_NOTE =
  "Read from the chain by the atlas worker, not atlas text; cite set_tx_url, not an atlas document, for these values. " +
  "Amounts are scaled by the token's decimals (decimals_source token or constant) or, where neither is known, by decimals inferred from the limit's size. " +
  "Where history_complete is false the contract is still being read, " +
  "so a missing fact is not proof of absence. atlas_onchain lists the complete set.";

const found = (text: string, re: RegExp, map: Map<string, OnchainFact[]>) =>
  [...new Set(text.match(re) ?? [])].flatMap((x) => map.get(x.toLowerCase()) ?? []);

/** The facts a result names: by a key it states, then by a document it returns, then by an address it mentions. */
export function factsNamedIn(text: string, idx: FactIndex): OnchainFact[] {
  return [...new Set([...found(text, HASH_RE, idx.byHash), ...found(text, UUID_RE, idx.byDoc), ...found(text, ADDRESS_RE, idx.byAddress)])];
}

const brief = (f: OnchainFact) => ({
  entity: f.entity, chain: f.chain, kind: f.kind, name: f.name, name_source: f.name_source, contract: f.contract,
  ...f.summary,
  set_tx_url: f.set_at?.url ?? null, history_complete: f.history_complete,
});

/** The result with an `onchain` block when it names any stored fact, or says which sources could not be read; an error result is left as it was. */
export async function attachOnchain(ix: Indexes, result: ToolResult): Promise<ToolResult> {
  if ("error" in result) return result;
  const idx = await factIndex(ix).catch(() => null);
  const facts = idx ? factsNamedIn(JSON.stringify(result), idx) : [];
  if (idx?.failed.length) return { ...result, onchain: { sources_failed: idx.failed, note: SOURCES_FAILED_NOTE, facts: facts.slice(0, MAX_FACTS).map(brief) } };
  if (facts.length === 0) return result;
  const truncated = facts.length > MAX_FACTS ? { truncated: true } : {};
  const shown = facts.slice(0, MAX_FACTS);
  const readAt = shown.map((f) => f.read_at).sort()[0];
  return { ...result, onchain: { note: ONCHAIN_NOTE, read_at: readAt, count: facts.length, ...truncated, facts: shown.map(brief) } };
}

/** A tool handler whose result carries the on-chain facts it names. */
export const withOnchain =
  (handler: AtlasHandler): AtlasHandler =>
  async (ix, args, ctx) =>
    attachOnchain(ix, await handler(ix, args, ctx));
