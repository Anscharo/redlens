// GET /api/prime-polls → { polls: PrimePoll[] }: every Snapshot poll in the
// Prime spaces the vote record's executives link (VoteIndex.snapshotSpaces),
// each with the atlas PRs its body links (src/lib/primePolls.ts). Read from the
// Snapshot hub at most once per CACHE_MS, served stale when the hub does not
// answer, and 503 until it has answered once, so a reader can tell "no polls"
// from "not read".
import { toPrimePoll, type PrimePoll, type SnapshotProposal } from "../lib/primePolls.ts";
import { politeFetch } from "../lib/upstreamBackoff.ts";
import { json } from "./http.ts";
import { loadVoteIndexFromDisk } from "./votes.ts";

const HUB = "https://hub.snapshot.org/graphql";
const CACHE_MS = 10 * 60_000;
/** The hub's page limit; a space past it is read in pages. */
const PAGE = 1000;

const QUERY = `query ($spaces: [String], $skip: Int) {
  proposals(first: ${PAGE}, skip: $skip, where: { space_in: $spaces }, orderBy: "created", orderDirection: desc) {
    id title space { id } end state choices scores discussion body
  }
}`;

async function page(spaces: string[], skip: number): Promise<SnapshotProposal[]> {
  const res = await politeFetch(HUB, { method: "POST", headers: { "content-type": "application/json", "user-agent": "redlens-prime-polls" }, body: JSON.stringify({ query: QUERY, variables: { spaces, skip } }) });
  if (!res.ok) throw new Error(`snapshot hub → HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { proposals?: SnapshotProposal[] }; errors?: unknown[] };
  if (!body.data?.proposals) throw new Error(`snapshot hub → ${JSON.stringify(body.errors ?? "no data").slice(0, 200)}`);
  return body.data.proposals;
}

/** Every poll in the spaces, page by page until a short page. */
export async function readPrimePolls(spaces: string[], read = page): Promise<PrimePoll[]> {
  const out: SnapshotProposal[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const got = await read(spaces, skip);
    out.push(...got);
    if (got.length < PAGE) return out.map(toPrimePoll);
  }
}

let cache: { at: number; polls: PrimePoll[] } | null = null;

/** The polls, from the cache while it is fresh, else from the hub; the last answer when the hub fails; null when it never answered. */
export async function currentPrimePolls(now = Date.now(), spaces = loadVoteIndexFromDisk()?.snapshotSpaces ?? []): Promise<PrimePoll[] | null> {
  if (cache && now - cache.at < CACHE_MS) return cache.polls;
  if (spaces.length === 0) return cache?.polls ?? null;
  try {
    cache = { at: now, polls: await readPrimePolls(spaces) };
  } catch (e) {
    console.warn(`prime polls: ${(e as Error).message}`);
  }
  return cache?.polls ?? null;
}

/** Forgets the cached polls (tests). */
export const resetPrimePolls = () => {
  cache = null;
};

export async function handlePrimePolls(): Promise<Response> {
  const polls = await currentPrimePolls();
  if (!polls) return json({ error: "unavailable" }, 503);
  return Response.json({ polls }, { headers: { "Cache-Control": "public, max-age=300" } });
}
