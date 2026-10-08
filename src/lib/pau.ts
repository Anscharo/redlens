// The PAU snapshot shape GET /api/pau serves (written by src/server/pau/), and
// the pure helpers the Radar PAU section reads it with. DOM-free, so the server
// and the browser share one declaration.
import type { PauKind, PauRole } from "./pauRegistry.ts";

/** Where a value was last set: the block, its time and the transaction. */
export interface SetAt {
  block: number;
  time: string;
  tx: string;
}

export interface RoleHolder {
  role: string;
  account: string;
  since: SetAt;
}

/** A replayed role holder, confirmed on-chain: `holds` is null when hasRole could not be read. */
export interface LiveRoleHolder extends RoleHolder {
  name: string | null;
  holds: boolean | null;
}

export interface AgentMember {
  account: string;
  since: SetAt;
}

export interface RateLimitKey {
  key: string;
  /** The last RateLimitDataSet, as configured (the live read can differ only by usage). */
  configured: { maxAmount: string; slope: string };
  setAt: SetAt;
  /** How many times the key has been set. */
  changes: number;
}

/** The controller constant a key is derived from, and what it is encoded with (an address, or a domain or endpoint id). */
export interface DerivedKey {
  constant: string;
  args: string[];
}

export interface LiveRateLimit extends RateLimitKey {
  /** On-chain RateLimitData, null when the read failed. */
  data: { maxAmount: string; slope: string; lastAmount: string; lastUpdated: string } | null;
  /** Amount available now, null when the read failed. */
  available: string | null;
  /** How the key is derived, when a controller constant reproduces it. */
  derived?: DerivedKey;
}

export interface PauParam {
  event: string;
  /** The first argument: the pool, token, domain or vault the value is for. */
  subject: string;
  args: Record<string, unknown>;
  setAt: SetAt;
}

export interface PauIntegration {
  id: string;
  config: unknown;
  setAt: SetAt;
}

export interface ContractState {
  role: PauRole;
  address: string;
  label?: string;
  roles?: LiveRoleHolder[];
  /** AdministeredAgent membership by kind: actors, admins, grantors, revokers. */
  agent?: Record<string, AgentMember[]>;
  rateLimits?: LiveRateLimit[];
  params?: PauParam[];
  integrations?: PauIntegration[];
  /** Admin events stored for this contract. */
  events: number;
  /** Every event type's history is read to the confirmed head; until then an absent part means "not read yet". */
  historyComplete: boolean;
}

export interface PauSnapshot {
  deployment: string;
  prime: string;
  primeName: string;
  chain: string;
  kind: PauKind;
  contracts: ContractState[];
}

export type StoredPauSnapshot = PauSnapshot & { fetchedAt: string };

/** GET /api/pau. */
export interface PauResponse {
  deployments: StoredPauSnapshot[];
}

export const EMPTY_PAU: PauResponse = { deployments: [] };
