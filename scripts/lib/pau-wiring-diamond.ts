/**
 * Diamond PAU wiring: the Controller's own pointers (proxy, rate limits,
 * access controls, beacon), the facets its integrations dispatch to, and the
 * AdministeredAgent's actors (relayers) and revokers (freezers). The last
 * three are enumerable on-chain, so anything the chain holds and the registry
 * does not becomes a proposal instead of a silent gap.
 */
import { deploymentId, membersOf, type PauDeployment, type PauRegistry, type PauRole } from "../../src/lib/pauRegistry.ts";
import { addrs, expectAddress, lower, pointerProposals, readNamed, type OnchainProposal, type Reader, type WiringCheck, type WiringReport } from "./pau-wiring.ts";

interface Integration {
  id: string;
  config: { facet: string };
}

function sharedOnChain(reg: PauRegistry, chain: string, role: PauRole): string[] {
  return reg.shared.filter((s) => s.chain === chain).flatMap((s) => s.members.filter((m) => m.role === role).map((m) => m.address));
}

/** Two-way comparison of an on-chain set with the registry's members of one role. */
function compareSets(d: PauDeployment, role: PauRole, onchain: string[], registry: string[], note: string) {
  const checks: WiringCheck[] = registry.map((a) => ({
    deployment: deploymentId(d),
    check: `${role} ${a}`,
    ok: onchain.includes(a),
    detail: onchain.includes(a) ? `listed on-chain (${note})` : `NOT listed on-chain (${note})`,
  }));
  const proposals: OnchainProposal[] = onchain
    .filter((a) => !registry.includes(a))
    .map((address) => ({ deployment: deploymentId(d), chain: d.chain, role, address, note }));
  return { checks, proposals };
}

/** Every address an AdministeredAgent enumerates under one list (actors or revokers). */
async function enumerate(read: Reader, d: PauDeployment, agent: string, kind: "Actor" | "Revoker", count: unknown): Promise<string[]> {
  const n = typeof count === "bigint" ? Number(count) : 0;
  const calls = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [String(i), { address: agent, functionName: `get${kind}`, args: [BigInt(i)] }]),
  );
  const res = await readNamed(read, d.chain, calls);
  return Object.values(res).flatMap((v) => (lower(v) ? [lower(v)!] : []));
}

/** The Controller's pointers, its integrations, and the agent's list sizes, in one batch. */
function readDiamond(d: PauDeployment, read: Reader, controller: string, agent: string | undefined) {
  return readNamed(read, d.chain, {
    proxy: { address: controller, functionName: "proxy" },
    rateLimits: { address: controller, functionName: "rateLimits" },
    accessControls: { address: controller, functionName: "accessControls" },
    beacon: { address: controller, functionName: "beacon" },
    integrations: { address: controller, functionName: "integrations" },
    ...(agent && {
      actorCount: { address: agent, functionName: "actorCount" },
      revokerCount: { address: agent, functionName: "revokerCount" },
    }),
  });
}

/**
 * The sets the diamond enumerates itself: facets from `integrations()`, and
 * the AdministeredAgent's actors (relayers) and revokers (freezers), each
 * compared with the registry both ways.
 */
async function compareEnumerated(d: PauDeployment, reg: PauRegistry, read: Reader, r: Record<string, unknown>, agent: string | undefined) {
  const facets = ((r.integrations as Integration[] | null) ?? []).map((i) => i.config.facet.toLowerCase());
  const shared = sharedOnChain(reg, d.chain, "facet");
  const parts = [compareSets(d, "facet", [...new Set(facets)], [...addrs(d, "facet"), ...shared], "Controller.integrations()")];
  if (agent) {
    const actors = await enumerate(read, d, agent, "Actor", r.actorCount);
    const revokers = await enumerate(read, d, agent, "Revoker", r.revokerCount);
    parts.push(compareSets(d, "relayer", actors, addrs(d, "relayer"), "AdministeredAgent actors"));
    parts.push(compareSets(d, "freezer", revokers, addrs(d, "freezer"), "AdministeredAgent revokers"));
  }
  // Shared facets are checked against every diamond on their chain; only the
  // ones this diamond actually dispatches to are expected here.
  const undispatchedShared = (c: WiringCheck) => c.check.startsWith("facet ") && !c.ok && shared.includes(c.check.slice(6));
  return {
    checks: parts.flatMap((p) => p.checks).filter((c) => !undispatchedShared(c)),
    proposals: parts.flatMap((p) => p.proposals),
  };
}

export async function checkDiamond(d: PauDeployment, reg: PauRegistry, read: Reader): Promise<WiringReport> {
  const controller = membersOf(d, "controller")[0].address;
  const agent = membersOf(d, "administeredAgent")[0]?.address;
  const r = await readDiamond(d, read, controller, agent);
  const checks: WiringCheck[] = [
    expectAddress(d, "proxy", r.proxy, addrs(d, "almProxy")),
    expectAddress(d, "rateLimits", r.rateLimits, addrs(d, "rateLimits")),
    expectAddress(d, "accessControls", r.accessControls, addrs(d, "accessControls")),
    expectAddress(d, "beacon", r.beacon, [...addrs(d, "beacon"), ...sharedOnChain(reg, d.chain, "beacon")]),
  ];
  const enumerated = await compareEnumerated(d, reg, read, r, agent);
  const pointerRoles = { proxy: "almProxy", rateLimits: "rateLimits", accessControls: "accessControls", beacon: "beacon" } as const;
  return {
    checks: [...checks, ...enumerated.checks],
    proposals: [...pointerProposals(d, checks, pointerRoles), ...enumerated.proposals],
  };
}
