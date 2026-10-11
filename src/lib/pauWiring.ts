// Whether a deployment's controller can act. The ALM proxy holds the funds and
// RateLimits meters them, and each answers only a caller holding its CONTROLLER
// role, so a controller missing either cannot do its job. Said only from
// complete role histories with every holder's live check read; until then,
// nothing is said.
import type { ContractState, PauSnapshot } from "./pau.ts";

export interface ControllerWiring {
  /** Holds CONTROLLER on one of the deployment's ALM proxies. */
  proxy: boolean;
  /** Holds CONTROLLER on one of its RateLimits contracts. */
  rateLimits: boolean;
}

const settled = (c: ContractState) => c.historyComplete && (c.roles ?? []).every((r) => r.holds !== null);
const holds = (c: ContractState, account: string) =>
  (c.roles ?? []).some((r) => r.name === "CONTROLLER" && r.holds && r.account.toLowerCase() === account);

/** The controller's CONTROLLER grants, or null when the deployment lists no controller or the role history is not complete. */
export function controllerWiring(snap: PauSnapshot): ControllerWiring | null {
  const controller = snap.contracts.find((c) => c.role === "controller");
  const proxies = snap.contracts.filter((c) => c.role === "almProxy");
  const limits = snap.contracts.filter((c) => c.role === "rateLimits");
  if (!controller || proxies.length === 0 || limits.length === 0 || ![...proxies, ...limits].every(settled)) return null;
  const me = controller.address.toLowerCase();
  return { proxy: proxies.some((c) => holds(c, me)), rateLimits: limits.some((c) => holds(c, me)) };
}
