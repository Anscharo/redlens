// Folds a contract's admin events, oldest first, into its current configuration.
// AccessControl is not enumerable on-chain, so replaying RoleGranted /
// RoleRevoked is how the holders are listed at all; the snapshot still asks
// hasRole of each, so a missed event shows up as a holder the chain denies.
import { keccak256, toHex } from "viem";
import { subjectKey } from "./admin-events.ts";

export interface PauEventRow {
  contract: string;
  event: string;
  args: Record<string, unknown>;
  block: number;
  block_time: string;
  tx_hash: string;
}

/** Where a value was last set: the block, its time and the transaction. */
export interface SetAt {
  block: number;
  time: string;
  tx: string;
}

const setAt = (e: PauEventRow): SetAt => ({ block: e.block, time: e.block_time, tx: e.tx_hash });

const ROLE_NAMES = new Map<string, string>([
  [`0x${"0".repeat(64)}`, "DEFAULT_ADMIN_ROLE"],
  ...["RELAYER", "FREEZER", "CONTROLLER"].map((n) => [keccak256(toHex(n)), n] as [string, string]),
]);

/** The name of a well-known role hash, else null. */
export const roleName = (hash: string): string | null => ROLE_NAMES.get(hash.toLowerCase()) ?? null;

export interface RoleHolder {
  role: string;
  account: string;
  since: SetAt;
}

/** Accounts holding each role after replaying grants and revokes. */
export function replayRoles(events: PauEventRow[]): RoleHolder[] {
  const held = new Map<string, RoleHolder>();
  for (const e of events) {
    const role = String(e.args.role);
    const account = String(e.args.account);
    if (e.event === "RoleGranted" && !held.has(`${role}:${account}`)) held.set(`${role}:${account}`, { role, account, since: setAt(e) });
    if (e.event === "RoleRevoked") held.delete(`${role}:${account}`);
  }
  return [...held.values()];
}

const AGENT_EVENT = /^(Actor|Admin|Grantor|Revoker)(Added|Removed)$/;

/** AdministeredAgent membership by kind (actors, admins, grantors, revokers). */
export function replayAgent(events: PauEventRow[]): Record<string, { account: string; since: SetAt }[]> {
  const sets = new Map<string, Map<string, SetAt>>();
  for (const e of events) {
    const m = AGENT_EVENT.exec(e.event);
    if (!m) continue;
    const kind = `${m[1].toLowerCase()}s`;
    const set = sets.get(kind) ?? new Map<string, SetAt>();
    sets.set(kind, set);
    const account = String(e.args.account);
    if (m[2] === "Added" && !set.has(account)) set.set(account, setAt(e));
    if (m[2] === "Removed") set.delete(account);
  }
  return Object.fromEntries([...sets].map(([k, set]) => [k, [...set].map(([account, since]) => ({ account, since }))]));
}

export interface RateLimitKey {
  key: string;
  /** The last RateLimitDataSet, as configured (the live read can differ only by usage). */
  configured: { maxAmount: string; slope: string };
  setAt: SetAt;
  /** How many times the key has been set. */
  changes: number;
}

/** Every key a RateLimits contract has ever been given, with its latest setting. */
export function replayRateLimitKeys(events: PauEventRow[]): RateLimitKey[] {
  const keys = new Map<string, RateLimitKey>();
  for (const e of events.filter((x) => x.event === "RateLimitDataSet")) {
    const key = String(e.args.key);
    const configured = { maxAmount: String(e.args.maxAmount), slope: String(e.args.slope) };
    keys.set(key, { key, configured, setAt: setAt(e), changes: (keys.get(key)?.changes ?? 0) + 1 });
  }
  return [...keys.values()];
}

/** Diamond integrations by id: IntegrationSet replaces, IntegrationRemoved deletes. */
export function replayIntegrations(events: PauEventRow[]): { id: string; config: unknown; setAt: SetAt }[] {
  const live = new Map<string, { id: string; config: unknown; setAt: SetAt }>();
  for (const e of events) {
    const id = String(e.args.id);
    if (e.event === "IntegrationSet") live.set(id, { id, config: e.args.config, setAt: setAt(e) });
    if (e.event === "IntegrationRemoved") live.delete(id);
  }
  return [...live.values()];
}

// Events that are not a parameter: role, membership and integration changes
// have their own replays, and RelayerRemoved is the freezer acting.
const NOT_PARAMS = /^(Role|Integration|RelayerRemoved$|RateLimitDataSet$)|(Added|Removed)$/;

export interface PauParam {
  event: string;
  /** The first argument: the pool, token, domain or vault the value is for. */
  subject: string;
  args: Record<string, unknown>;
  setAt: SetAt;
}

/** The latest value of each (parameter event, subject), e.g. MaxSlippageSet per pool. */
export function replayParams(events: PauEventRow[]): PauParam[] {
  const latest = new Map<string, PauParam>();
  for (const e of events) {
    if (NOT_PARAMS.test(e.event)) continue;
    const subject = String(e.args[subjectKey(e.event) ?? ""] ?? "");
    latest.set(`${e.event}:${subject}`, { event: e.event, subject, args: e.args, setAt: setAt(e) });
  }
  return [...latest.values()];
}
