// GET /api/pau/steps → ValueStepsResponse: what governance did about each
// rate-limit value a prime's documents state and its chain disagrees with or
// never set (src/lib/pauPending.ts `withOnchain`), and who can change it
// (pauKeyRoutes.ts), worked out here from what the server already holds: the
// value checks it builds for the on-chain facts (pau-value-facts.ts), the
// stored snapshots with each chain's Configurator from the registry, the
// documents' history and the spells their PRs name, the PAU change history, the
// vote record, the open atlas PRs and the Prime Snapshot polls. A page fetches
// only this, keyed by `valueCheckId`, and only when it shows a disagreement.
//
// An input that cannot be read is named in `unread` and never read as empty:
// without the PAU history, the vote record or the documents' history no step
// is given; without the open PRs a change the chain made first says nothing,
// and without the polls a PR linked only through one says nothing. Built at
// most once per CACHE_MS, one build at a time; a failed build is not kept.
import type { HistoryEntry } from "../../lib/history.ts";
import type { StoredPauSnapshot } from "../../lib/pau.ts";
import type { ValueCheck } from "../../lib/pauAtlasValues.ts";
import type { OpenAtlasPr } from "../../lib/pauChainLed.ts";
import { datedDocs, valueCheckId, withOnchain, type ValueStep } from "../../lib/pauPending.ts";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { pollsByPr } from "../../lib/primePolls.ts";
import registry from "../../data/pau-registry.json" with { type: "json" };
import { readHistoryBatch } from "../history/history.ts";
import { json } from "../http.ts";
import { primeValueChecks } from "../onchain/pau-value-facts.ts";
import { fetchOpenPrs } from "../preview/open-prs.ts";
import { currentPrimePolls } from "../prime-polls.ts";
import { getIndexes, type Indexes } from "../retrieval/indexes.ts";
import { loadVoteIndexFromDisk } from "../votes.ts";
import { currentPauHistory } from "./history.ts";
import { readPauState } from "./store.ts";

export type StepInput = "pau-history" | "votes" | "history" | "open-prs" | "polls";

export interface ValueStepsResponse {
  steps: ValueStep[];
  unread: StepInput[];
}

const CACHE_MS = 60_000;

/** Each snapshot with its chain's Configurator (registry `shared`) on every BeamState block, so a registry edit shows without the chain being read again. */
export function withConfigurators(snaps: StoredPauSnapshot[], reg: PauRegistry): StoredPauSnapshot[] {
  const of = (chain: string) => reg.shared.find((s) => s.chain === chain)?.members.find((m) => m.role === "configurator")?.address ?? null;
  return snaps.map((s) => ({ ...s, contracts: s.contracts.map((c) => (c.beam ? { ...c, beam: { ...c.beam, configurator: of(s.chain) } } : c)) }));
}

/** A promise's value, or null when it rejects, naming the input in `unread`. */
const soft = <T,>(p: Promise<T | null>, name: StepInput, unread: StepInput[]): Promise<T | null> =>
  p.then(
    (v) => (v === null && unread.push(name), v),
    () => (unread.push(name), null),
  );

/** Each prime's value checks against its snapshots, and the atlas's doc_nos by UUID. */
export interface PrimeChecks {
  primes: { snaps: StoredPauSnapshot[]; checks: ValueCheck[] }[];
  docNo: (uuid: string) => string | null;
}

/** What the steps are built from; each read is replaceable in tests. */
export interface StepDeps {
  checks: () => Promise<PrimeChecks>;
  history: (ids: string[]) => Promise<Map<string, HistoryEntry[]>>;
  pau: typeof currentPauHistory;
  votes: typeof loadVoteIndexFromDisk;
  openPrs: () => Promise<OpenAtlasPr[] | null>;
  polls: () => ReturnType<typeof currentPrimePolls>;
}

/** Every prime's checks, as the on-chain facts build them, from the served atlas and the stored snapshots. */
async function serverChecks(ix: Indexes = getIndexes()): Promise<PrimeChecks> {
  const snaps = withConfigurators(await readPauState(), registry as PauRegistry);
  const primes = [...new Set(snaps.map((s) => s.prime))].map((p) => snaps.filter((s) => s.prime === p));
  return { primes: primes.map((ps) => ({ snaps: ps, checks: primeValueChecks(ix, ps[0].prime, ps) })), docNo: (uuid) => ix.docMap.get(uuid)?.doc_no ?? null };
}

const DEPS: StepDeps = {
  checks: () => serverChecks(),
  history: readHistoryBatch,
  pau: currentPauHistory,
  votes: () => loadVoteIndexFromDisk(),
  openPrs: async () => (await fetchOpenPrs())?.map((p) => ({ number: p.number, title: p.title, url: p.url, body: p.body, updatedAt: p.updatedAt })) ?? null,
  polls: () => currentPrimePolls(),
};

/** Every disagreement's step and routes, from the inputs `deps` reads. */
export async function readValueSteps(deps: StepDeps = DEPS, now = Date.now()): Promise<ValueStepsResponse> {
  const unread: StepInput[] = [];
  const { primes, docNo } = await deps.checks();
  const ids = datedDocs(primes.flatMap((p) => p.checks));
  const votes = deps.votes();
  if (!votes) unread.push("votes");
  const [history, pau, openPrs, polls] = await Promise.all([soft(deps.history(ids), "history", unread), soft(deps.pau(), "pau-history", unread), soft(deps.openPrs(), "open-prs", unread), soft(deps.polls(), "polls", unread)]);
  if (!votes || !history || !pau) return { steps: [], unread };
  const base = {
    executives: votes.executives, pau, today: new Date(now).toISOString().slice(0, 10), now, snapshots: votes.snapshots,
    ...(openPrs ? { openPrs } : {}), ...(polls ? { pollsByPr: pollsByPr(polls) } : {}), docNo,
  };
  const steps = primes.flatMap((p) => withOnchain(p.checks, history, { ...base, snaps: p.snaps }))
    .filter((c) => c.onchain || c.routes)
    .map((c) => ({ id: valueCheckId(c), ...(c.onchain ? { onchain: c.onchain } : {}), ...(c.routes ? { routes: c.routes } : {}) }));
  return { steps, unread };
}

let cache: { at: number; built: Promise<ValueStepsResponse> } | null = null;

/** The steps as last built, rebuilt once CACHE_MS old; one build at a time, and a failed one is not kept. */
export function currentValueSteps(now = Date.now()): Promise<ValueStepsResponse> {
  if (cache && now - cache.at < CACHE_MS) return cache.built;
  const entry = { at: now, built: readValueSteps(DEPS, now) };
  cache = entry;
  entry.built.catch(() => {
    if (cache === entry) cache = null;
  });
  return entry.built;
}

export async function handleValueSteps(): Promise<Response> {
  try {
    return json(await currentValueSteps(), 200, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    console.error(`pau steps: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}
