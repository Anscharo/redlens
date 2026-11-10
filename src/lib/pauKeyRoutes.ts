// Who can change one rate limit, and whether the Operator can reach the value
// the atlas states for it. Two routes exist:
//   - a spell, through an account holding DEFAULT_ADMIN_ROLE on the RateLimits
//     (a Prime's SubProxy on Ethereum, the chain's Executor elsewhere);
//   - the Operator (a cBEAM), through the chain's Configurator, where BeamState
//     manages the RateLimits and the Configurator holds DEFAULT_ADMIN_ROLE on it.
// The Operator's rules are the atlas's Operator Execution (7a98000b,
// A.2.2.10.1.1.1.2.4.1.4.1): a limit locked as unlimited (92a74fe1,
// A.2.2.10.1.1.1.2.4.1.1.3) cannot move; any other may be lowered to anything
// at any time; a raise may take maxAmount or slope no higher than the larger of
// the current value times maxChange and the key's registered default (942d6607,
// A.2.2.10.1.1.1.2.4.1.1.2.1), and only once `hop` has passed since the last
// raise to that limit (dc0e3a84, A.2.2.10.1.1.1.2.4.1.1.1.1). Whether a cBEAM is
// paired with the RateLimits and whether the Configurator is halted are not
// read. Pure.
import type { BeamLimits, StoredPauSnapshot } from "./pau.ts";
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { PauHistoryResponse } from "./pauHistory.ts";
import { parseStated, shiftDecimal } from "./pauParams.ts";
import { namedDecimals } from "./pauValueVerdict.ts";

const UNLIMITED = (1n << 256n) - 1n;
const WAD = 10n ** 18n;
const DAY = 86_400n;
/** More raises than this is treated as out of reach: the bound grows geometrically, so a real target is far fewer steps away. */
const MAX_RAISES = 200;

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
  /** Null when BeamState does not manage the RateLimits, the Configurator holds no admin role on it, or the snapshot predates recording the Configurator; `reach` is null where the stated value's units or BeamState's bounds are not read. */
  operator: { reach: Reach | null } | null;
}

const rateLimitsOf = (c: ValueCheck, snaps: readonly StoredPauSnapshot[]) =>
  snaps.filter((s) => s.chain === c.chain && (!c.kind || s.kind === c.kind)).flatMap((s) => s.contracts).find((x) => x.address.toLowerCase() === c.contract?.toLowerCase());

const admins = (roles: { name: string | null; account: string; holds: boolean | null }[] | undefined) =>
  (roles ?? []).filter((r) => r.name === "DEFAULT_ADMIN_ROLE" && r.holds !== false).map((r) => r.account.toLowerCase());

/** The key's decimals: its token's on chain, else the one decimals every token the atlas names for it shares ("USDC", "RLUSD or USDC"); null otherwise. */
function decimalsOf(c: ValueCheck, symbol: string | null): number | null {
  if (c.limit?.unit) return c.limit.unit.decimals;
  const named = namedDecimals(symbol);
  return named && named.every((d) => d === named[0]) ? named[0] : null;
}

/** The stated value in the key's raw units: a slope per second (the atlas states it per day); null where the units are not known or the text is not an amount. */
export function statedRaw(c: ValueCheck): bigint | null {
  const s = parseStated(c.stated);
  if (s?.kind === "unlimited") return UNLIMITED;
  const decimals = s?.kind === "amount" ? decimalsOf(c, s.symbol) : null;
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

/** When the Operator last raised this field of the key, from the PAU history's Operator changes; null when it never did. */
function lastRaise(pau: PauHistoryResponse, c: ValueCheck): number | null {
  const key = c.key?.toLowerCase();
  const raised = pau.entries.filter((e) => e.origin?.kind === "operator" && e.changes.some((ch) => ch.subject?.toLowerCase() === key && BigInt(String(ch.args[c.field] ?? 0)) > BigInt(String(ch.before?.[c.field] ?? 0))));
  return raised.length ? Date.parse(raised.at(-1)!.time) : null;
}

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
export function keyRoutes(c: ValueCheck, snaps: readonly StoredPauSnapshot[], pau: PauHistoryResponse, now: number): KeyRoutes | null {
  const rl = rateLimitsOf(c, snaps);
  if (!rl) return null;
  const all = admins(rl.roles);
  if (all.length === 0) return null;
  const conf = rl.beam?.configurator?.toLowerCase() ?? null;
  const operatorOn = !!rl.beam && !!conf && all.includes(conf);
  return { admins: all.filter((a) => a !== conf), operator: operatorOn ? { reach: reachOf(c, rl.beam!, pau, now) } : null };
}
