// What the pools and vaults a deployment's keys name answer about themselves:
// a Curve pool's coins, so an instance's underlying assets can be checked
// against the pool, and a vault's owner() and curator(), and, for each account
// the atlas names to its allocator or sentinel role (role-claims.ts), whether
// the vault says that account holds it. Only what the chain answers is kept: a
// vault that is not a Morpho vault answers none of these and gets no entry, and
// coins stop at the first index the pool does not answer.
import type { PauSnapshot, TargetState } from "../../lib/pau.ts";
import { EVM_ADDRESS_EXACT_RE } from "../../lib/patterns.ts";
import { EXCHANGE_RATE_EVENTS } from "./param-subjects.ts";
import type { RoleClaim, RoleClaims } from "./role-claims.ts";
import type { ChainCall, ChainReader } from "./snapshot.ts";

/** A StableSwap-NG pool holds at most eight coins. */
const MAX_COINS = 8;
const CURVE_RE = /^LIMIT_CURVE_/;
const VAULT_RE = /^LIMIT_(4626|7540)_/;

interface TargetRead {
  target: string;
  call: ChainCall;
  put: (t: TargetState, v: unknown) => void;
}

/** The Curve pools and the vaults the deployment's keys and exchange-rate parameters name, lowercased. */
function integrations(snap: PauSnapshot): { pools: string[]; vaults: string[] } {
  const limits = snap.contracts.flatMap((c) => c.rateLimits ?? []);
  const lastArg = (re: RegExp) => limits.flatMap((r) => (r.derived && re.test(r.derived.constant) && r.derived.args.length ? [r.derived.args[r.derived.args.length - 1].toLowerCase()] : []));
  const rates = snap.contracts.flatMap((c) => c.params ?? []).filter((p) => EXCHANGE_RATE_EVENTS.has(p.event)).map((p) => p.subject.toLowerCase());
  const addresses = (xs: string[]) => [...new Set(xs.filter((x) => EVM_ADDRESS_EXACT_RE.test(x)))];
  return { pools: addresses(lastArg(CURVE_RE)), vaults: addresses([...lastArg(VAULT_RE), ...rates]) };
}

/** coins(0..7); a coin is kept only while every earlier index answered. */
const coinReads = (pool: string): TargetRead[] =>
  Array.from({ length: MAX_COINS }, (_, i) => ({
    target: pool,
    call: { address: pool, functionName: "coins", args: [BigInt(i)] },
    put: (t, v) => {
      if (typeof v === "string" && (t.coins ?? []).length === i) t.coins = [...(t.coins ?? []), v.toLowerCase()];
    },
  }));

function vaultReads(vault: string, claim: RoleClaim | undefined): TargetRead[] {
  const call = (functionName: ChainCall["functionName"], args: readonly unknown[] = []): ChainCall => ({ address: vault, functionName, args });
  const account = (key: "owner" | "curator") => (t: TargetState, v: unknown) => {
    if (typeof v === "string") t[key] = v.toLowerCase();
  };
  const holds = (key: "allocators" | "sentinels", a: string) => (t: TargetState, v: unknown) => {
    if (typeof v === "boolean") t[key] = { ...t[key], [a]: v };
  };
  return [
    { target: vault, call: call("owner"), put: account("owner") },
    { target: vault, call: call("curator"), put: account("curator") },
    ...(claim?.allocators ?? []).map((a) => ({ target: vault, call: call("isAllocator", [a]), put: holds("allocators", a) })),
    ...(claim?.sentinels ?? []).map((a) => ({ target: vault, call: call("isSentinel", [a]), put: holds("sentinels", a) })),
  ];
}

/** The snapshot with `targets` attached for every pool and vault that answers. */
export async function withTargets(snap: PauSnapshot, read: ChainReader, claims: RoleClaims = new Map()): Promise<PauSnapshot> {
  const { pools, vaults } = integrations(snap);
  const reads = [...pools.flatMap(coinReads), ...vaults.flatMap((v) => vaultReads(v, claims.get(v)))];
  if (reads.length === 0) return snap;
  const res = await read(snap.chain, reads.map((r) => r.call));
  const targets: Record<string, TargetState> = {};
  reads.forEach((r, i) => r.put((targets[r.target] ??= {}), res[i]));
  const answered = Object.entries(targets).filter(([, t]) => Object.keys(t).length > 0);
  return answered.length ? { ...snap, targets: Object.fromEntries(answered) } : snap;
}
