// Pure helpers for the Radar PAU section: which snapshots belong to a prime,
// how on-chain amounts read, and which instance names each rate-limit key.
import type { ContractState, PauResponse, PauSnapshot, SetAt, StoredPauSnapshot } from "./pau.ts";
import { RATE_LIMIT_ID_RE } from "./atlasHashes.ts";

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

/** A raw amount as an exact decimal string ("25000000", "1.5"), or "unlimited" for the max uint256 sentinel. */
export function exactAmount(raw: string, decimals: number): string {
  const v = BigInt(raw);
  if (v === UNLIMITED) return "unlimited";
  const scale = 10n ** BigInt(decimals);
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / scale}.${frac}` : `${v / scale}`;
}

/**
 * A raw amount rounded to whole units ("25000000"), or exact below one unit.
 * A refill per day is stored per second and truncated, so its exact value
 * ("24999999.9264") is noise against the atlas's round figure.
 */
export function wholeAmount(raw: string, decimals: number): string {
  const v = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  return v === UNLIMITED || v < scale ? exactAmount(raw, decimals) : ((v + scale / 2n) / scale).toString();
}

/** A per-second slope as an amount per day. */
export const formatPerDay = (slope: string, decimals: number): string =>
  BigInt(slope) === 0n ? "0" : formatAmount((BigInt(slope) * 86_400n).toString(), decimals);

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const KEY_WORDS = /\s*Rate\s*Limit\s*IDs?\b\s*(?:\/\s*)?/i;

export interface AtlasKeyRef {
  docId: string | null;
  label: string;
}

/** The slice of a Radar instance the key index reads: its name and its extracted parameters. */
export interface KeyedInstance {
  displayName: string;
  signalParams: { key: string; value: string; srcDocId: string | null }[];
}

/** The prime's own controller-wide keys (build-graph's prime meta.params) as a nameless instance. */
export function primeKeyedInstance(meta: string | null | undefined): KeyedInstance {
  const params = (JSON.parse(meta ?? "{}") as { params?: Record<string, [string, string | null]> }).params ?? {};
  return { displayName: "", signalParams: Object.entries(params).map(([key, [value, srcDocId]]) => ({ key, value, srcDocId: srcDocId || null })) };
}

/**
 * Rate-limit keys the prime and its instances state as RateLimitID parameters
 * (build-graph's params, the same rows the instance cards show), each labelled
 * "<instance> · <param>" ("SparkLend ETH · Inflow"), or the param alone for the
 * prime's own ("USDS Mint"). A key several instances state lists every one,
 * sorted by label. Other hashes (pool IDs) are not keys and are skipped.
 */
export function instanceKeyIndex(instances: KeyedInstance[]): Map<string, AtlasKeyRef[]> {
  const index = new Map<string, AtlasKeyRef[]>();
  for (const inst of instances) {
    for (const p of inst.signalParams) {
      if (!RATE_LIMIT_ID_RE.test(p.key) || !KEY_RE.test(p.value.trim())) continue;
      // A param that is only "Rate Limit IDs" (a conduit's one key) is named by its instance.
      const what = p.key.replace(KEY_WORDS, " ").replace(/\s+/g, " ").trim();
      const key = p.value.trim().toLowerCase();
      const label = [inst.displayName, what].filter(Boolean).join(" · ") || p.key;
      index.set(key, [...(index.get(key) ?? []), { docId: p.srcDocId, label }]);
    }
  }
  // Sorted, so the name a key shows does not depend on instance order.
  for (const refs of index.values()) refs.sort((a, b) => a.label.localeCompare(b.label));
  return index;
}

/**
 * A key label without the instance-name prefix that names the deployment's own
 * chain ("Ethereum Mainnet - Aave Core v3 USDC · Inflow" on the Ethereum card
 * reads "Aave Core v3 USDC · Inflow"). A prefix naming another chain stays.
 */
export function labelOnChain(label: string, chain: string): string {
  const m = /^([^·]+?) - (.+)$/.exec(label);
  return m && m[1].toLowerCase().includes(chain.toLowerCase()) ? m[2] : label;
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
