// Pure helpers for the Radar PAU section: which snapshots belong to a prime,
// how on-chain amounts read, and which instance names each rate-limit key.
import type { ContractState, PauResponse, PauSnapshot, SetAt, StoredPauSnapshot } from "./pau.ts";

const CHAIN_FIRST = "ethereum";

/** A prime's deployments: Ethereum first, then by chain, monolithic before diamond on one chain. */
export function snapshotsForPrime(res: PauResponse, prime: string): StoredPauSnapshot[] {
  return res.deployments
    .filter((d) => d.prime === prime)
    .sort((a, b) => Number(b.chain === CHAIN_FIRST) - Number(a.chain === CHAIN_FIRST) || a.chain.localeCompare(b.chain) || b.kind.localeCompare(a.kind));
}

const UNLIMITED = (1n << 256n) - 1n;
const WAD = 10n ** 18n;

/**
 * Token decimals a rate limit is denominated in. RateLimits stores raw amounts
 * with no token attached, so the scale is inferred: PAU limits are in USDS
 * (18 decimals) or USDC/USDT (6), and a limit of at least 1e18 raw units is
 * read as 18 decimals because 6-decimal it would exceed a trillion dollars.
 */
export const inferDecimals = (maxAmount: string): 6 | 18 => (BigInt(maxAmount) >= WAD ? 18 : 6);

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** A raw token amount in compact form ("25M"), or "unlimited" for the max uint256 sentinel. */
export function formatAmount(raw: string, decimals: number): string {
  const v = BigInt(raw);
  if (v === UNLIMITED) return "unlimited";
  const scale = 10n ** BigInt(decimals);
  return COMPACT.format(Number(v / scale) + Number(v % scale) / Number(scale));
}

/** A per-second slope as an amount per day. */
export const formatPerDay = (slope: string, decimals: number): string =>
  BigInt(slope) === 0n ? "0" : formatAmount((BigInt(slope) * 86_400n).toString(), decimals);

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const KEY_WORDS = /\s*Rate\s*Limit\s*ID\b/i;

export interface AtlasKeyRef {
  docId: string | null;
  label: string;
}

/** The slice of a Radar instance the key index reads: its name and its extracted parameters. */
export interface KeyedInstance {
  displayName: string;
  signalParams: { key: string; value: string; srcDocId: string | null }[];
}

/**
 * Rate-limit keys the prime's instances state as parameters (build-graph's
 * instance params, the same rows the instance cards show), each labelled
 * "<instance> · <param>" ("SparkLend ETH · Inflow").
 */
export function instanceKeyIndex(instances: KeyedInstance[]): Map<string, AtlasKeyRef[]> {
  const index = new Map<string, AtlasKeyRef[]>();
  for (const inst of instances) {
    for (const p of inst.signalParams) {
      if (!KEY_RE.test(p.value.trim())) continue;
      const what = p.key.replace(KEY_WORDS, "").trim() || p.key;
      const key = p.value.trim().toLowerCase();
      index.set(key, [...(index.get(key) ?? []), { docId: p.srcDocId, label: `${inst.displayName} · ${what}` }]);
    }
  }
  return index;
}

/** "holds" / "denied" (the history says granted, the chain says no) / "unread" (hasRole failed) / "member" (AdministeredAgent, enumerated). */
export type HolderStatus = "holds" | "denied" | "unread" | "member";

export interface HolderRow {
  /** The PAU contract the role is held on. */
  on: ContractState["role"];
  /** Role name ("RELAYER"), AdministeredAgent membership ("actor"), or a short hash for an unnamed role. */
  name: string;
  account: string;
  status: HolderStatus;
  since: SetAt;
}

const AGENT_NAME: Record<string, string> = { actors: "actor", revokers: "revoker", admins: "admin", grantors: "grantor" };

function contractHolders(c: ContractState): HolderRow[] {
  const roles = (c.roles ?? []).map((r) => ({
    on: c.role,
    name: r.name ?? `${r.role.slice(0, 10)}…`,
    account: r.account,
    status: (r.holds === null ? "unread" : r.holds ? "holds" : "denied") as HolderStatus,
    since: r.since,
  }));
  const agent = Object.entries(c.agent ?? {}).flatMap(([kind, members]) =>
    members.map((m) => ({ on: c.role, name: AGENT_NAME[kind] ?? kind, account: m.account, status: "member" as const, since: m.since })),
  );
  return [...roles, ...agent];
}

/** Every role holder and AdministeredAgent member of a deployment, grouped by role name. */
export function holderRows(snap: PauSnapshot): HolderRow[] {
  return snap.contracts.flatMap(contractHolders).sort((a, b) => a.name.localeCompare(b.name) || a.on.localeCompare(b.on));
}
