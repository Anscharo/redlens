/**
 * Runs the wiring checks for every registry deployment. A monolithic
 * controller (MainnetController / ForeignController) is checked by pointer
 * and by hasRole, since its AccessControl is not enumerable; a diamond goes
 * through pau-wiring-diamond.ts.
 *
 * For both, the live controller is whoever the RateLimits contract grants
 * CONTROLLER to. Spells rotate controllers without the atlas always
 * following, so the grant history (explorer logs) names the candidates and
 * hasRole confirms which still hold the role. A deployment whose controller
 * the atlas marks TBC gets its controller proposed the same way.
 */
import { toEventSelector } from "viem";
import { deploymentId, membersOf, type PauDeployment, type PauRegistry } from "../../src/lib/pauRegistry.ts";
import type { LogFetcher } from "./explorer-logs.ts";
import { checkDiamond } from "./pau-wiring-diamond.ts";
import { addrs, expectAddress, expectHolders, pointerProposals, readNamed, type OnchainProposal, type Reader, type WiringCall, type WiringCheck, type WiringReport } from "./pau-wiring.ts";

const ROLE_GRANTED = toEventSelector("RoleGranted(bytes32,address,address)");
const day = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Grant history of `role` on `rl`; an explorer failure leaves only the registry's own candidates. */
async function grantHistory(d: PauDeployment, logs: LogFetcher | null, rl: string, role: string) {
  if (!logs) return { grants: [], note: "no grant history (explorer lookup off)" };
  try {
    const grants = await logs(d.chain, rl, [ROLE_GRANTED, role]);
    return grants ? { grants, note: "" } : { grants: [], note: `no grant history (no explorer for ${d.chain})` };
  } catch (e) {
    return { grants: [], note: `no grant history (${(e as Error).message})` };
  }
}

type LiveControllers =
  | { failed: string }
  | { live: Map<string, string>; unread: string[]; note: string };

/**
 * Accounts holding CONTROLLER on the deployment's RateLimits now, with the date
 * each was granted; null when the registry lists no RateLimits to ask. An
 * unreadable role constant is a failure, never "nobody holds it".
 */
async function liveControllers(d: PauDeployment, read: Reader, logs: LogFetcher | null): Promise<LiveControllers | null> {
  const rl = membersOf(d, "rateLimits")[0]?.address;
  if (!rl) return null;
  const { role } = await readNamed(read, d.chain, { role: { address: rl, functionName: "CONTROLLER" } });
  if (role === null) return { failed: "RateLimits.CONTROLLER() call failed; live controller not checked" };
  const granted = new Map<string, string>(addrs(d, "controller").map((a) => [a, "?"]));
  const { grants, note } = await grantHistory(d, logs, rl, String(role));
  for (const l of grants) granted.set(`0x${l.topics[2].slice(26)}`, day(l.timeStamp));
  const calls = Object.fromEntries([...granted.keys()].map((a) => [a, { address: rl, functionName: "hasRole", args: [role, a] }]));
  const held = await readNamed(read, d.chain, calls);
  const unread = [...granted.keys()].filter((a) => held[a] === null);
  return { live: new Map([...granted].filter(([a]) => held[a] === true)), unread, note };
}

function liveControllerCheck(id: string, a: string, found: Exclude<LiveControllers, { failed: string }>): WiringCheck {
  const { live, unread, note } = found;
  const suffix = note ? `; ${note}` : "";
  if (unread.includes(a)) return { deployment: id, check: "live controller", ok: false, detail: `RateLimits.hasRole(CONTROLLER) call failed for ${a}${suffix}` };
  if (live.has(a)) return { deployment: id, check: "live controller", ok: true, detail: `RateLimits grants CONTROLLER to it${suffix}` };
  const liveText = live.size ? [...live].map(([l, since]) => `${l} (granted ${since})`).join(", ") : "none found";
  return { deployment: id, check: "live controller", ok: false, detail: `RateLimits does NOT grant CONTROLLER to ${a}; live: ${liveText}${suffix}` };
}

/** For a deployment with no listed controller: what the RateLimits grants say instead. */
function unlistedControllerCheck(id: string, found: Exclude<LiveControllers, { failed: string }>): WiringCheck {
  const suffix = found.note ? `; ${found.note}` : "";
  const live = [...found.live].map(([a, since]) => `${a} (granted ${since})`).join(", ");
  return { deployment: id, check: "live controller", ok: false, detail: live ? `RateLimits grants CONTROLLER to ${live}; see proposals` : `no holder found${suffix}` };
}

async function controllerChecks(d: PauDeployment, read: Reader, logs: LogFetcher | null): Promise<WiringReport> {
  const id = deploymentId(d);
  const found = await liveControllers(d, read, logs);
  if (!found) return { checks: [], proposals: [] };
  if ("failed" in found) return { checks: [{ deployment: id, check: "live controller", ok: false, detail: found.failed }], proposals: [] };
  const listed = addrs(d, "controller");
  const checks = listed.length ? listed.map((a) => liveControllerCheck(id, a, found)) : [unlistedControllerCheck(id, found)];
  const proposals: OnchainProposal[] = [...found.live]
    .filter(([a]) => !listed.includes(a))
    .map(([address, since]) => ({ deployment: id, chain: d.chain, role: "controller", address, note: `holds CONTROLLER on RateLimits (granted ${since})` }));
  return { checks, proposals };
}

/** hasRole for each registry holder of `role`; an unreadable role constant fails the check rather than skipping it. */
async function roleHolders(
  read: Reader,
  d: PauDeployment,
  role: "freezer" | "relayer",
  constant: unknown,
  holds: (role: unknown) => (a: string) => WiringCall,
): Promise<WiringCheck[]> {
  if (constant !== null) return expectHolders(read, d, role, holds(constant));
  if (!addrs(d, role).length) return [];
  return [{ deployment: deploymentId(d), check: role, ok: false, detail: `${role.toUpperCase()}() call failed; holders not checked` }];
}

export async function checkMonolith(d: PauDeployment, read: Reader, controller: string): Promise<WiringReport> {
  const r = await readNamed(read, d.chain, {
    proxy: { address: controller, functionName: "proxy" },
    rateLimits: { address: controller, functionName: "rateLimits" },
    FREEZER: { address: controller, functionName: "FREEZER" },
    RELAYER: { address: controller, functionName: "RELAYER" },
  });
  const holds = (role: unknown) => (a: string) => ({ address: controller, functionName: "hasRole", args: [role, a] });
  const pointers = [expectAddress(d, "proxy", r.proxy, addrs(d, "almProxy")), expectAddress(d, "rateLimits", r.rateLimits, addrs(d, "rateLimits"))];
  const proposals = pointerProposals(d, pointers, { proxy: "almProxy", rateLimits: "rateLimits" });
  const checks = [
    ...pointers,
    ...(await roleHolders(read, d, "freezer", r.FREEZER, holds)),
    ...(await roleHolders(read, d, "relayer", r.RELAYER, holds)),
  ];
  return { checks, proposals };
}

function noControllerDetail(d: PauDeployment): string {
  return membersOf(d, "rateLimits").length
    ? "no controller in registry"
    : "no controller and no RateLimits in registry; nothing to read";
}

/** Wiring checks for every deployment, plus on-chain proposals. */
export async function checkRegistryWiring(reg: PauRegistry, read: Reader, logs: LogFetcher | null): Promise<WiringReport> {
  const report: WiringReport = { checks: [], proposals: [] };
  for (const d of reg.deployments) {
    const parts = [await controllerChecks(d, read, logs)];
    // Every listed controller is checked: a draft can hold the old and the newly listed one side by side.
    for (const { address } of membersOf(d, "controller")) {
      parts.push(d.kind === "diamond" ? await checkDiamond(d, reg, read, address) : await checkMonolith(d, read, address));
    }
    if (!membersOf(d, "controller").length) report.checks.push({ deployment: deploymentId(d), check: "controller", ok: false, detail: noControllerDetail(d) });
    for (const p of parts) {
      report.checks.push(...p.checks);
      report.proposals.push(...p.proposals);
    }
  }
  return report;
}
