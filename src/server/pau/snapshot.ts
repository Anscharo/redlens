// One deployment's live state: what its admin-event history says is configured,
// checked against the chain. Role holders come from the replay and each is
// confirmed with hasRole; rate-limit keys come from RateLimitDataSet and each
// is read live, because usage moves the available amount between settings.
import { parseAbi } from "viem";
import { deploymentId, type PauDeployment, type PauMember, type PauRole } from "../../lib/pauRegistry.ts";
import { replayAgent, replayIntegrations, replayParams, replayRateLimitKeys, replayRoles, roleName, type PauEventRow, type PauParam, type RateLimitKey, type RoleHolder } from "./replay.ts";

export const PAU_STATE_ABI = parseAbi([
  "function hasRole(bytes32, address) view returns (bool)",
  "struct RateLimitData { uint256 maxAmount; uint256 slope; uint256 lastAmount; uint256 lastUpdated; }",
  "function getRateLimitData(bytes32) view returns (RateLimitData)",
  "function getCurrentRateLimit(bytes32) view returns (uint256)",
]);

export interface ChainCall {
  address: string;
  functionName: "hasRole" | "getRateLimitData" | "getCurrentRateLimit";
  args: readonly unknown[];
}
/** Reads every call on one chain with PAU_STATE_ABI; a call that fails resolves to null. */
export type ChainReader = (chain: string, calls: ChainCall[]) => Promise<unknown[]>;

export interface LiveRateLimit extends RateLimitKey {
  /** On-chain RateLimitData, null when the read failed. */
  data: { maxAmount: string; slope: string; lastAmount: string; lastUpdated: string } | null;
  /** Amount available now, null when the read failed. */
  available: string | null;
}

/** A contract's stored admin events, and whether they cover its whole history. */
export interface ContractHistory {
  events: PauEventRow[];
  complete: boolean;
}

export interface ContractState {
  role: PauRole;
  address: string;
  label?: string;
  roles?: (RoleHolder & { name: string | null; holds: boolean | null })[];
  agent?: ReturnType<typeof replayAgent>;
  rateLimits?: LiveRateLimit[];
  params?: PauParam[];
  integrations?: ReturnType<typeof replayIntegrations>;
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
  kind: PauDeployment["kind"];
  contracts: ContractState[];
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

/** What one contract's history and the chain say, by the parts that apply to it. */
export async function contractState(read: ChainReader, chain: string, m: PauMember, history: ContractHistory): Promise<ContractState> {
  const { events, complete } = history;
  const out: ContractState = { role: m.role, address: m.address, ...(m.label ? { label: m.label } : {}), events: events.length, historyComplete: complete };
  const holders = replayRoles(events);
  if (holders.length) out.roles = await liveRoles(read, chain, m.address, holders);
  const agent = replayAgent(events);
  if (Object.keys(agent).length) out.agent = agent;
  const keys = replayRateLimitKeys(events);
  if (keys.length) out.rateLimits = await liveRateLimits(read, chain, m.address, keys);
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
): Promise<PauSnapshot> {
  const contracts: ContractState[] = [];
  for (const m of d.members.filter((x) => READ_ROLES.has(x.role))) {
    contracts.push(await contractState(read, d.chain, m, await historyOf(d.chain, m.address)));
  }
  return { deployment: deploymentId(d), prime: d.prime, primeName: d.primeName, chain: d.chain, kind: d.kind, contracts };
}
