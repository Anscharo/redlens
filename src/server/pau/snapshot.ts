// One deployment's live state: what its admin-event history says is configured,
// checked against the chain. Role holders come from the replay and each is
// confirmed with hasRole; AdministeredAgent members are listed live
// (agent-live.ts); rate-limit keys come from RateLimitDataSet and each is read
// live, because usage moves the available amount between settings.
import { parseAbi } from "viem";
import { deploymentId, type PauDeployment, type PauMember, type PauRole } from "../../lib/pauRegistry.ts";
import type { AgentMember, BeamDefault, ContractState, DerivedKey, LiveRateLimit, PauSnapshot, RateLimitKey, RoleHolder } from "../../lib/pau.ts";
import { liveAgent } from "./agent-live.ts";
import { beamLimits, type BeamSource } from "./beam.ts";
import { probeKeys } from "./probe.ts";
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
  // What AaveFacet reads from an aToken to build its keys (facet-keys.ts HOOKS), and the unit of its withdrawals
  "function POOL() view returns (address)",
  "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
  // A DssSpell's own state (vote-archive.ts)
  "function done() view returns (bool)", "function expiration() view returns (uint256)",
  // AdministeredAgent membership (agent-live.ts)
  "function actorCount() view returns (uint256)", "function getActor(uint256) view returns (address)", "function getIsActor(address) view returns (bool)",
  "function adminCount() view returns (uint256)", "function getAdmin(uint256) view returns (address)", "function getIsAdmin(address) view returns (bool)",
  "function grantorCount() view returns (uint256)", "function getGrantor(uint256) view returns (address)", "function getIsGrantor(address) view returns (bool)",
  "function revokerCount() view returns (uint256)", "function getRevoker(uint256) view returns (address)", "function getIsRevoker(address) view returns (bool)",
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

/** What a RateLimits snapshot reads beyond its own history: its chain's BeamState, and the atlas keys to read live. */
export interface RateLimitsExtras {
  beam?: BeamSource;
  probe?: string[];
}

/** What one contract's history and the chain say, by the parts that apply to it; a RateLimits also gets what its chain's BeamState allows and which atlas keys it has never set. */
export async function contractState(read: ChainReader, chain: string, m: PauMember, history: ContractHistory, extras: RateLimitsExtras = {}): Promise<ContractState> {
  const { events, complete } = history;
  const out: ContractState = { role: m.role, address: m.address, ...(m.label ? { label: m.label } : {}), events: events.length, historyComplete: complete };
  const holders = replayRoles(events);
  if (holders.length) out.roles = await liveRoles(read, chain, m.address, holders);
  if (m.role === "administeredAgent") await agentState(out, read, chain, replayAgent(events));
  const keys = replayRateLimitKeys(events);
  if (keys.length) out.rateLimits = await liveRateLimits(read, chain, m.address, keys);
  if (m.role === "rateLimits") await rateLimitsExtras(out, read, chain, keys.map((k) => k.key), extras);
  const params = replayParams(events);
  if (params.length) out.params = params;
  const integrations = replayIntegrations(events);
  if (integrations.length) out.integrations = integrations;
  return out;
}

async function agentState(out: ContractState, read: ChainReader, chain: string, replayed: Record<string, AgentMember[]>) {
  const { agent, missed } = await liveAgent(read, chain, out.address, replayed);
  if (Object.keys(agent).length) out.agent = agent;
  if (missed) out.historyComplete = false;
}

async function rateLimitsExtras(out: ContractState, read: ChainReader, chain: string, held: string[], { beam, probe }: RateLimitsExtras) {
  const managed = beam ? await beamLimits(read, chain, beam, out.address, held) : null;
  if (managed) out.beam = managed;
  if (!probe?.length) return;
  const { unset, missed } = await probeKeys(read, chain, out.address, probe, new Set(held.map((k) => k.toLowerCase())));
  if (unset.length) out.unsetKeys = unset;
  if (missed) out.historyComplete = false;
}

/** Relayers and freezers hold no admin events of their own; their roles show on the contracts. */
const READ_ROLES = new Set<PauRole>(["controller", "almProxy", "rateLimits", "accessControls", "administeredAgent"]);

export async function buildSnapshot(
  d: PauDeployment,
  read: ChainReader,
  historyOf: (chain: string, contract: string) => Promise<ContractHistory>,
  extras: RateLimitsExtras = {},
): Promise<PauSnapshot> {
  const contracts: ContractState[] = [];
  for (const m of d.members.filter((x) => READ_ROLES.has(x.role))) {
    contracts.push(await contractState(read, d.chain, m, await historyOf(d.chain, m.address), extras));
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
