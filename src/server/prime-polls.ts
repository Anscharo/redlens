// The Prime Snapshot polls (src/lib/primePolls.ts) for the on-chain steps
// (src/server/pau/value-steps.ts): every poll in the Prime spaces the vote
// record's executives link (VoteIndex.snapshotSpaces), each with the atlas PRs
// its body links. A closed poll never changes, so its body is read once: each
// refresh lists every poll's id and state, then reads in full only the polls
// not read yet or not settled. One refresh runs at a time, at most once per
// CACHE_MS; while it runs the last answer is served at once, and after a
// failure, or while the hub's host is held off, the hub is not asked for
// FAILED_MS. Null until the hub has answered once, so a reader can tell "no
// polls" from "not read".
import { toPrimePoll, type PrimePoll, type SnapshotProposal } from "../lib/primePolls.ts";
import { coolingDown, politeFetch } from "../lib/upstreamBackoff.ts";
import { loadVoteIndexFromDisk } from "./votes.ts";

const HUB = "https://hub.snapshot.org/graphql";
const CACHE_MS = 10 * 60_000;
const FAILED_MS = 5 * 60_000;
/** The hub's page limit; a longer list is read in pages. */
const PAGE = 1000;
/** The most ids the hub takes in one `id_in`; more are read in batches of this size. */
const IDS_PER_QUERY = 100;

const LIST = `query ($spaces: [String], $skip: Int) {
  proposals(first: ${PAGE}, skip: $skip, where: { space_in: $spaces }, orderBy: "created", orderDirection: desc) { id state }
}`;
const FULL = `query ($ids: [String]) {
  proposals(first: ${IDS_PER_QUERY}, where: { id_in: $ids }, orderBy: "created", orderDirection: desc) {
    id title space { id } end state choices scores discussion body
  }
}`;

/** One page of proposals a query matches. */
export type HubRead = <T>(query: string, variables: Record<string, unknown>) => Promise<T[]>;

const hubRead: HubRead = async <T,>(query: string, variables: Record<string, unknown>) => {
  const res = await politeFetch(HUB, { method: "POST", headers: { "content-type": "application/json", "user-agent": "redlens-prime-polls" }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`snapshot hub → HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { proposals?: T[] }; errors?: unknown[] };
  if (!body.data?.proposals) throw new Error(`snapshot hub → ${JSON.stringify(body.errors ?? "no data").slice(0, 200)}`);
  return body.data.proposals;
};

/** Every proposal the query matches, page by page until a short page. */
async function allPages<T>(read: HubRead, query: string, variables: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const got = await read<T>(query, { ...variables, skip });
    out.push(...got);
    if (got.length < PAGE) return out;
  }
}

/** The polls in the spaces, by id: those `known` already holds settled kept as they are, every other one read in full. */
export async function readPrimePolls(spaces: string[], known: ReadonlyMap<string, PrimePoll>, read: HubRead = hubRead): Promise<Map<string, PrimePoll>> {
  const listed = await allPages<{ id: string; state: string }>(read, LIST, { spaces });
  const settled = (p: { id: string; state: string }) => p.state === "closed" && known.get(p.id.toLowerCase())?.passed != null;
  const toRead = listed.filter((p) => !settled(p)).map((p) => p.id);
  const full: SnapshotProposal[] = [];
  for (let i = 0; i < toRead.length; i += IDS_PER_QUERY) full.push(...(await read<SnapshotProposal>(FULL, { ids: toRead.slice(i, i + IDS_PER_QUERY) })));
  const out = new Map<string, PrimePoll>();
  for (const p of listed.filter(settled)) out.set(p.id.toLowerCase(), known.get(p.id.toLowerCase())!);
  for (const p of full.map(toPrimePoll)) out.set(p.id, p);
  return out;
}

let cache: { at: number; polls: Map<string, PrimePoll> } | null = null;
let failedAt = -Infinity;
let refreshing: Promise<void> | null = null;

function refresh(spaces: string[], read: HubRead, now: number): Promise<void> {
  refreshing ??= readPrimePolls(spaces, cache?.polls ?? new Map(), read)
    .then(
      (polls) => {
        cache = { at: now, polls };
      },
      (e) => {
        failedAt = now;
        console.warn(`prime polls: ${(e as Error).message}`);
      },
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** The polls: the last answer, refreshed in the background once it is CACHE_MS old; the first read is waited for; null while the hub has never answered. */
export async function currentPrimePolls(now = Date.now(), spaces = loadVoteIndexFromDisk()?.snapshotSpaces ?? [], read: HubRead = hubRead): Promise<PrimePoll[] | null> {
  const due = !cache || now - cache.at >= CACHE_MS;
  const may = spaces.length > 0 && now - failedAt >= FAILED_MS && !coolingDown(HUB);
  if (due && may) {
    const running = refresh(spaces, read, now);
    if (!cache) await running;
  }
  return cache ? [...cache.polls.values()] : null;
}

/** Forgets the cached polls (tests). */
export const resetPrimePolls = () => {
  cache = null;
  failedAt = -Infinity;
  refreshing = null;
};
