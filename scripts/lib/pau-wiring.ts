/**
 * On-chain wiring checks for registry deployments: does each controller point
 * at the proxy and rate limits the registry lists, and do the registry's
 * relayers and freezers actually hold their roles? A diamond also enumerates
 * its own facets, actors (relayers) and revokers (freezers), which come back
 * as on-chain proposals for anything the registry lacks.
 *
 * Reads go through an injected Reader so the checks are testable offline;
 * rpcReader() is the real one (one multicall per batch, a failed call → null).
 */
import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { MULTICALL3, rpcFor } from "../../src/server/balances/fetch-balances.ts";
import { politeFetch, withBackoff } from "../../src/lib/upstreamBackoff.ts";
import { deploymentId, membersOf, type PauDeployment, type PauRole } from "../../src/lib/pauRegistry.ts";

export const PAU_WIRING_ABI = parseAbi([
  "function proxy() view returns (address)",
  "function rateLimits() view returns (address)",
  "function accessControls() view returns (address)",
  "function beacon() view returns (address)",
  "function FREEZER() view returns (bytes32)",
  "function RELAYER() view returns (bytes32)",
  "function CONTROLLER() view returns (bytes32)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function actorCount() view returns (uint256)",
  "function revokerCount() view returns (uint256)",
  "function getActor(uint256) view returns (address)",
  "function getRevoker(uint256) view returns (address)",
  "struct Wire { bytes4 callSelector; bytes4 delegateSelector; }",
  "struct Config { address facet; Wire[] wires; }",
  "struct Integration { bytes32 id; Config config; }",
  "function integrations() view returns (Integration[])",
]);

export interface WiringCall {
  address: string;
  functionName: string;
  args?: readonly unknown[];
}
/** Reads every call on one chain; a call that reverts or fails resolves to null. */
export type Reader = (chain: string, calls: WiringCall[]) => Promise<unknown[]>;

export interface WiringCheck {
  deployment: string;
  check: string;
  ok: boolean;
  detail: string;
  /** The address the chain returned, for pointer checks. */
  actual?: string | null;
}

/** Something the chain says belongs to a deployment that the registry does not list. */
export interface OnchainProposal {
  deployment: string;
  chain: string;
  role: PauRole;
  address: string;
  note: string;
}

export interface WiringReport {
  checks: WiringCheck[];
  proposals: OnchainProposal[];
}

export function rpcReader(): Reader {
  const clients = new Map<string, PublicClient>();
  return async (chain, calls) => {
    const rpc = rpcFor(chain);
    if (!rpc) return calls.map(() => null);
    if (!clients.has(chain)) clients.set(chain, createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 0, fetchFn: politeFetch }) }));
    const contracts = calls.map((c) => ({ ...c, abi: PAU_WIRING_ABI })) as never[];
    try {
      const res = await withBackoff(rpc, () => clients.get(chain)!.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3 }));
      return res.map((r) => (r.status === "success" ? r.result : null));
    } catch {
      // An unreachable RPC fails this chain's checks ("call failed"), not the run.
      return calls.map(() => null);
    }
  };
}

/** Calls keyed by name, read in one batch, returned under the same names. */
export async function readNamed(read: Reader, chain: string, named: Record<string, WiringCall>): Promise<Record<string, unknown>> {
  const keys = Object.keys(named);
  const values = keys.length ? await read(chain, keys.map((k) => named[k])) : [];
  return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? null]));
}

export const lower = (v: unknown): string | null => (typeof v === "string" ? v.toLowerCase() : null);

/** One check comparing an on-chain address with the registry's expectation. */
export function expectAddress(d: PauDeployment, check: string, actual: unknown, expected: string[]): WiringCheck {
  const got = lower(actual);
  const ok = got !== null && expected.includes(got);
  const want = expected.length ? expected.join(" | ") : "(none in registry)";
  const detail = got === null ? `call failed; registry has ${want}` : `chain ${got}; registry has ${want}`;
  return { deployment: deploymentId(d), check, ok, detail, actual: got };
}

export const addrs = (d: PauDeployment, role: PauRole) => membersOf(d, role).map((m) => m.address);

/** A role check per registry member: does `holds(address)` come back true on-chain? */
export async function expectHolders(
  read: Reader,
  d: PauDeployment,
  role: PauRole,
  call: (address: string) => WiringCall,
): Promise<WiringCheck[]> {
  const members = addrs(d, role);
  const named = Object.fromEntries(members.map((a) => [a, call(a)]));
  const res = await readNamed(read, d.chain, named);
  return members.map((a) => ({
    deployment: deploymentId(d),
    check: `${role} ${a}`,
    ok: res[a] === true,
    detail: res[a] === null ? "call failed" : res[a] ? "holds the role" : "does NOT hold the role",
  }));
}

/** A pointer the chain disagrees on becomes a proposal for the role it points at. */
export function pointerProposals(d: PauDeployment, checks: WiringCheck[], roleOf: Record<string, PauRole>): OnchainProposal[] {
  return checks
    .filter((c) => !c.ok && c.actual && roleOf[c.check])
    .map((c) => ({ deployment: deploymentId(d), chain: d.chain, role: roleOf[c.check], address: c.actual!, note: `controller.${c.check}()` }));
}
