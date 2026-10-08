// One deployment's live state: what its admin-event history says is configured,
// checked against the chain. Role holders come from the replay and each is
// confirmed with hasRole; rate-limit keys come from RateLimitDataSet and each
// is read live, because usage moves the available amount between settings.
import { parseAbi } from "viem";
import { deploymentId, type PauDeployment, type PauMember, type PauRole } from "../../lib/pauRegistry.ts";
import type { BeamDefault, ContractState, DerivedKey, LiveRateLimit, PauSnapshot, RateLimitKey, RoleHolder } from "../../lib/pau.ts";
import { beamLimits, type BeamSource } from "./beam.ts";
import { replayAgent, replayIntegrations, replayParams, replayRateLimitKeys, replayRoles, roleName, type PauEventRow } from "./replay.ts";

export const PAU_STATE_ABI = parseAbi([
  "function hasRole(bytes32, address) view returns (bool)",
  "struct RateLimitData { uint256 maxAmount; uint256 slope; uint256 lastAmount; uint256 lastUpdated; }",
  "function getRateLimitData(bytes32) view returns (RateLimitData)",
  "function getCurrentRateLimit(bytes32) view returns (uint256)",
  // BeamState (beam.ts)
  "function rateLimits(address) view returns (uint256)",
  "function getHop(address) view returns (uint256)",
  "function getMaxChange(address) view returns (uint256)",
  "function initRateLimits(bytes32, address) view returns (uint256 maxAmount, uint256 slope)",
  // The token a limit is counted in (units.ts)
  "function asset() view returns (address)",
  "function token() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export interface ChainCall {
  address: string;
  functionName: Extract<(typeof PAU_STATE_ABI)[number], { type: "function" }>["name"];
  args: readonly unknown[];
}
/** Reads every call on one chain with PAU_STATE_ABI; a call that fails resolves to null. */
export type ChainReader = (chain: string, calls: ChainCall[]) => Promise<unknown[]>;

export type { ContractState, LiveRateLimit, PauSnapshot };

/** A contract's stored admin events, and whether they cover its whole history. */
export interface ContractHistory {
  events: PauEventRow[];
  complete: boolean;
}

const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : null);

async function liveRoles(read: ChainReader, chain: string, address: string, holders: RoleHolder[]) {
  const res = await read(chain, holders.map((h) => ({ address, functionName: "hasRole" as const, args: [h.role, h.account] })));
  return holders.map((h, i) => ({ ...h, name: roleName(h.role), holds: typeof res[i] === "boolean" ? (res[i] as boolean) : null }));
}

async function liveRateLimits(read: ChainReader, chain: string, address: string, keys: RateLimitKey[]): Promise<LiveRateLimit[]> {
  const calls = keys.flatMap((k) => [
    { address, functionName: "getRateLimitData" as const, args: [k.key] },
    { address, functionName: "getCurrentRateLimit" as const, args: [k.key] },
  ]);
  const res = await read(chain, calls);
  return keys.map((k, i) => {
    const d = res[2 * i] as Record<string, bigint> | null;
    const data = d ? { maxAmount: String(d.maxAmount), slope: String(d.slope), lastAmount: String(d.lastAmount), lastUpdated: String(d.lastUpdated) } : null;
    return { ...k, data, available: str(res[2 * i + 1]) };
  });
}

/** What one contract's history and the chain say, by the parts that apply to it; a RateLimits also gets what its chain's BeamState allows. */
export async function contractState(read: ChainReader, chain: string, m: PauMember, history: ContractHistory, beam?: BeamSource): Promise<ContractState> {
  const { events, complete } = history;
  const out: ContractState = { role: m.role, address: m.address, ...(m.label ? { label: m.label } : {}), events: events.length, historyComplete: complete };
  const holders = replayRoles(events);
  if (holders.length) out.roles = await liveRoles(read, chain, m.address, holders);
  const agent = replayAgent(events);
  if (Object.keys(agent).length) out.agent = agent;
  const keys = replayRateLimitKeys(events);
  if (keys.length) out.rateLimits = await liveRateLimits(read, chain, m.address, keys);
  const managed = beam && m.role === "rateLimits" ? await beamLimits(read, chain, beam, m.address, keys.map((k) => k.key)) : null;
  if (managed) out.beam = managed;
  const params = replayParams(events);
  if (params.length) out.params = params;
  const integrations = replayIntegrations(events);
  if (integrations.length) out.integrations = integrations;
  return out;
}

/** Relayers and freezers hold no admin events of their own; their roles show on the contracts. */
const READ_ROLES = new Set<PauRole>(["controller", "almProxy", "rateLimits", "accessControls", "administeredAgent"]);

export async function buildSnapshot(
  d: PauDeployment,
  read: ChainReader,
  historyOf: (chain: string, contract: string) => Promise<ContractHistory>,
  beam?: BeamSource,
): Promise<PauSnapshot> {
  const contracts: ContractState[] = [];
  for (const m of d.members.filter((x) => READ_ROLES.has(x.role))) {
    contracts.push(await contractState(read, d.chain, m, await historyOf(d.chain, m.address), beam));
  }
  return { deployment: deploymentId(d), prime: d.prime, primeName: d.primeName, chain: d.chain, kind: d.kind, contracts };
}

/** The snapshot with every rate limit and BeamState default changed by `f`. */
export function mapLimits(snap: PauSnapshot, f: <T extends LiveRateLimit | BeamDefault>(x: T) => T): PauSnapshot {
  const contracts = snap.contracts.map((c) =>
    c.rateLimits || c.beam
      ? { ...c, ...(c.rateLimits ? { rateLimits: c.rateLimits.map(f) } : {}), ...(c.beam ? { beam: { ...c.beam, defaults: c.beam.defaults.map(f) } } : {}) }
      : c,
  );
  return { ...snap, contracts };
}

/** The snapshot with each rate-limit key's derivation attached where one is found. */
export function withDerivedKeys(snap: PauSnapshot, derive: (key: string) => DerivedKey | null): PauSnapshot {
  return mapLimits(snap, (x) => {
    const derived = derive(x.key);
    return derived ? { ...x, derived } : x;
  });
}
