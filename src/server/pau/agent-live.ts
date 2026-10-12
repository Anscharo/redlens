// AdministeredAgent membership as the chain lists it. Each set (actors, admins,
// grantors, revokers) is an EnumerableSet with a count, an index getter and a
// membership check, so the whole set is read live: a replayed member the chain
// does not list reads holds false, a listed account the history lacks is
// added with no `since` and marks the history incomplete, and a failed read is
// null, never false. The replay supplies only when each member was added.
import type { AgentMember } from "../../lib/pau.ts";
import type { ChainCall, ChainReader } from "./snapshot.ts";

const KINDS = { actors: "Actor", admins: "Admin", grantors: "Grantor", revokers: "Revoker" } as const;
type Kind = keyof typeof KINDS;

/** At most this many members are listed per set; a longer set reads as not fully listed. */
const MAX_LISTED = 100;

const fn = (kind: Kind, part: "count" | "get" | "is") =>
  (part === "count" ? `${KINDS[kind].toLowerCase()}Count` : part === "get" ? `get${KINDS[kind]}` : `getIs${KINDS[kind]}`) as ChainCall["functionName"];

const asCount = (v: unknown) => (typeof v === "bigint" && v <= BigInt(MAX_LISTED) ? Number(v) : null);

/** Each kind's full live list, or null where its count or any index could not be read. */
async function listAll(read: ChainReader, chain: string, address: string, kinds: Kind[]): Promise<Map<Kind, Set<string> | null>> {
  const counts = (await read(chain, kinds.map((k) => ({ address, functionName: fn(k, "count"), args: [] })))).map(asCount);
  const calls = kinds.flatMap((k, i) => Array.from({ length: counts[i] ?? 0 }, (_, n) => ({ address, functionName: fn(k, "get"), args: [BigInt(n)] })));
  const res = await read(chain, calls);
  let at = 0;
  return new Map(kinds.map((k, i) => {
    const got = res.slice(at, (at += counts[i] ?? 0));
    const complete = counts[i] !== null && got.every((a) => typeof a === "string");
    return [k, complete ? new Set(got.map((a) => String(a).toLowerCase())) : null];
  }));
}

/** Whether each replayed member is still in its set, by getIsX; null where the read failed. */
async function stillMembers(read: ChainReader, chain: string, address: string, replayed: [Kind, AgentMember][]): Promise<(boolean | null)[]> {
  const res = await read(chain, replayed.map(([k, m]) => ({ address, functionName: fn(k, "is"), args: [m.account] })));
  return res.map((v) => (typeof v === "boolean" ? v : null));
}

/** The replayed membership with each member confirmed live, plus members the chain lists that the history lacks. */
export async function liveAgent(read: ChainReader, chain: string, address: string, replay: Record<string, AgentMember[]>) {
  const kinds = Object.keys(KINDS) as Kind[];
  const replayed = kinds.flatMap((k) => (replay[k] ?? []).map((m) => [k, m] as [Kind, AgentMember]));
  const [lists, holds] = await Promise.all([listAll(read, chain, address, kinds), stillMembers(read, chain, address, replayed)]);
  const agent: Record<string, AgentMember[]> = {};
  let missed = false;
  for (const k of kinds) {
    const list = lists.get(k) ?? null;
    const known = replayed.flatMap(([kk, m], i) => (kk === k ? [{ ...m, holds: holds[i] ?? (list ? list.has(m.account.toLowerCase()) : null) }] : []));
    const seen = new Set(known.map((m) => m.account.toLowerCase()));
    const extra = [...(list ?? [])].filter((a) => !seen.has(a)).map((account) => ({ account, since: null, holds: true }));
    if (extra.length) missed = true;
    const members = [...known, ...extra].sort((a, b) => a.account.toLowerCase().localeCompare(b.account.toLowerCase()));
    if (members.length || k in replay) agent[k] = members;
  }
  return { agent, missed };
}
