// Who can change one rate limit, and whether the Operator can reach the value
// the atlas states for it. Two routes exist:
//   - a spell, through an account holding DEFAULT_ADMIN_ROLE on the RateLimits
//     (a Prime's SubProxy on Ethereum, the chain's Executor elsewhere);
//   - the Operator (a cBEAM), through the chain's Configurator, where BeamState
//     manages the RateLimits and the Configurator holds DEFAULT_ADMIN_ROLE on it.
// The Operator's rules are the atlas's Operator Execution (OPERATOR_RULES): a
// limit locked as unlimited cannot move; any other may be lowered to anything
// at any time; a raise may take maxAmount or slope no higher than the larger of
// the current value times maxChange and the key's registered default, and only
// once `hop` has passed since the last raise of either field of that limit on
// that RateLimits. Each reach carries the doc_no of the rule it rests on, for
// the text to cite. The stated value is read in the key's units only where the
// chain gave them: a guessed scale would make the reach a guess. Whether a
// cBEAM is paired with the RateLimits and whether the Configurator is halted
// are not read. A Solana limit has the spell route alone, relayed over
// LayerZero governance (pauSvmRoutes.ts). Pure.
import type { BeamLimits, StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { PauHistoryResponse } from "./pauHistory.ts";
import { parseStated, shiftDecimal } from "./pauParams.ts";
import { isSvmChain } from "./pauRegistry.ts";
import { svmKeyRoutes } from "./pauSvmRoutes.ts";

const UNLIMITED = (1n << 256n) - 1n;
const WAD = 10n ** 18n;
const DAY = 86_400n;
/** More raises than this is treated as out of reach: the bound grows geometrically, so a real target is far fewer steps away. */
const MAX_RAISES = 200;

/** The atlas documents the Operator's rules are stated in, by UUID (their doc_nos are looked up, never kept). */
export const OPERATOR_RULES = {
  /** Operator Execution: lower at any time, raise within bounds. */
  execution: "7a98000b-c069-42f3-b1a4-8a3e7323a960",
  /** The raise bound: max(current × maxChange, default). */
  bound: "942d6607-b92c-4779-8012-ea3b259ebf2b",
  /** The hop between raises. */
  hop: "dc0e3a84-b542-4985-a41b-7ae2a3921cf3",
  /** A limit locked as unlimited. */
  locked: "92a74fe1-3115-4cd7-bbf8-4e16fb4b0aa8",
} as const;

/** How the Operator could bring one field to the stated value. */
export type Reach =
  | { kind: "same" }
  | { kind: "lower" }
  | { kind: "raise"; raises: number; first: string; last: string }
  | { kind: "beyond" }
  | { kind: "locked" };

export interface KeyRoutes {
  /** Accounts holding DEFAULT_ADMIN_ROLE on the RateLimits other than the Configurator: a spell acts through them. */
  admins: string[];
  /** Null when BeamState does not manage the RateLimits, the Configurator holds no admin role on it, or the snapshot carries no Configurator; `reach` is null where the stated value's units or BeamState's bounds are not read. `cites` holds the doc_no of each rule the reach rests on, where the documents are at hand. */
  operator: { reach: Reach | null; cites?: string[] } | null;
  /** A Solana limit (pauSvmRoutes.ts): the spell's call reaches the admins over LayerZero governance; `cites` holds the doc_nos the route rests on; `direct`, any other admin, which can set the limit with no spell. */
  relay?: { via: "layerzero"; cites?: string[]; direct?: string[] };
}

const rateLimitsOf = (c: ValueCheck, snaps: readonly StoredPauSnapshot[]) =>
  snaps.filter((s) => s.chain === c.chain && (!c.kind || s.kind === c.kind)).flatMap((s) => s.contracts).find((x) => x.address.toLowerCase() === c.contract?.toLowerCase());

const admins = (roles: { name: string | null; account: string; holds: boolean | null }[] | undefined) =>
  (roles ?? []).filter((r) => r.name === "DEFAULT_ADMIN_ROLE" && r.holds !== false).map((r) => r.account.toLowerCase());

/** The stated value in the key's raw units: a slope per second (the atlas states it per day); null where the chain gave no units or the text is not an amount. */
export function statedRaw(c: ValueCheck): bigint | null {
  const s = parseStated(c.stated);
  if (s?.kind === "unlimited") return UNLIMITED;
  const decimals = c.limit?.unit?.decimals ?? null;
  if (s?.kind !== "amount" || decimals === null) return null;
  const raw = BigInt(shiftDecimal(s.units, decimals).split(".")[0]);
  return c.field === "slope" ? raw / DAY : raw;
}

/** How many raises take `current` to at least `target`, each to at most max(value × maxChange, default); null when the bound stops growing short of it. */
export function raisesTo(current: bigint, target: bigint, dflt: bigint, maxChange: bigint): number | null {
  let value = current;
  for (let n = 1; n <= MAX_RAISES; n++) {
    const cap = (value * maxChange) / WAD > dflt ? (value * maxChange) / WAD : dflt;
    if (cap >= target) return n;
    if (cap <= value) return null;
    value = cap;
  }
  return null;
}

/** A change's field as an integer; 0 where it is absent or not a number. */
const asInt = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? 0));
  } catch {
    return 0n;
  }
};

/** When the Operator last raised either field of this limit on this RateLimits, from the PAU history's Operator changes; null when it never did. */
function lastRaise(pau: PauHistoryResponse, c: ValueCheck): number | null {
  const key = c.key?.toLowerCase();
  const contract = c.contract?.toLowerCase();
  const raises = (ch: PauHistoryResponse["entries"][number]["changes"][number]) =>
    ch.contract.toLowerCase() === contract && ch.subject?.toLowerCase() === key && (["maxAmount", "slope"] as const).some((f) => asInt(ch.args[f]) > asInt(ch.before?.[f]));
  const raised = pau.entries.filter((e) => e.chain === c.chain && e.origin?.kind === "operator" && e.changes.some(raises));
  return raised.length ? Math.max(...raised.map((e) => Date.parse(e.time))) : null;
}

/** The rules each reach rests on. */
const RULES_OF: Record<Reach["kind"], (keyof typeof OPERATOR_RULES)[]> = { same: [], lower: ["execution"], raise: ["bound", "hop"], beyond: ["bound"], locked: ["locked"] };

/** The doc_nos of the rules a reach rests on, where `docNo` finds them. */
const citesOf = (reach: Reach | null, docNo?: (uuid: string) => string | null): string[] | undefined =>
  reach && docNo ? RULES_OF[reach.kind].map((r) => docNo(OPERATOR_RULES[r])).filter((d): d is string => !!d) : undefined;

/** The Operator's reach for the check's field, under the BeamState bounds. */
function reachOf(c: ValueCheck, beam: BeamLimits, pau: PauHistoryResponse, now: number): Reach | null {
  const target = statedRaw(c);
  const data = c.limit?.data;
  if (target === null || !data || beam.maxChange === null || beam.hop === null) return null;
  const d = beam.defaults.find((x) => x.key.toLowerCase() === c.key?.toLowerCase());
  const current = BigInt(data[c.field]);
  if ((d ? BigInt(d.maxAmount) === UNLIMITED : BigInt(data.maxAmount) === UNLIMITED)) return target === current ? { kind: "same" } : { kind: "locked" };
  if (target === current) return { kind: "same" };
  if (target < current) return { kind: "lower" };
  const raises = raisesTo(current, target, BigInt(d?.[c.field] ?? 0), BigInt(beam.maxChange));
  if (raises === null) return { kind: "beyond" };
  const hop = Number(beam.hop) * 1000;
  const first = Math.max(now, (lastRaise(pau, c) ?? -Infinity) + hop);
  return { kind: "raise", raises, first: new Date(first).toISOString(), last: new Date(first + (raises - 1) * hop).toISOString() };
}

/** Who can change the check's rate limit, and how far the Operator can take it; null when no snapshot holds the key's contract or no admin of it is read. */
export function keyRoutes(c: ValueCheck, snaps: readonly StoredPauSnapshot[], pau: PauHistoryResponse, now: number, docNo?: (uuid: string) => string | null): KeyRoutes | null {
  if (c.chain && isSvmChain(c.chain)) return svmKeyRoutes(c, snaps, docNo);
  const rl = rateLimitsOf(c, snaps);
  if (!rl) return null;
  const all = admins(rl.roles);
  if (all.length === 0) return null;
  const conf = rl.beam?.configurator?.toLowerCase() ?? null;
  const operatorOn = !!rl.beam && !!conf && all.includes(conf);
  if (!operatorOn) return { admins: all.filter((a) => a !== conf), operator: null };
  const reach = reachOf(c, rl.beam!, pau, now);
  const cites = citesOf(reach, docNo);
  return { admins: all.filter((a) => a !== conf), operator: { reach, ...(cites?.length ? { cites } : {}) } };
}
