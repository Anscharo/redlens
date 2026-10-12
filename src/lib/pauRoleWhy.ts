// Why a contract is listed in its role, as text for a tooltip: what the role
// does, who says this contract fills it, and (for a controller) whether the
// chain's role grants agree. Pure.
import type { ContractState, PauSnapshot } from "./pau.ts";
import { controllerWiring } from "./pauWiring.ts";

const MEANING: Record<string, string> = {
  controller: "Controller: the contract relayers call to move the PAU's funds, within the limits its rate limits contract meters.",
  almProxy: "ALM proxy: holds the PAU's funds and executes the controller's calls.",
  rateLimits: "Rate limits: meters how much the controller may move through each key.",
  accessControls: "AccessControls: holds the roles of a diamond controller.",
  administeredAgent: "AdministeredAgent: a diamond controller's lists of actors, admins, grantors and revokers.",
};

function source(c: ContractState): string {
  const docs = c.atlasDocs?.length ?? 0;
  if (docs > 0) return `Stated by ${docs === 1 ? "an atlas document" : `${docs} atlas documents`} (the role label links to it).`;
  return "No atlas document states this contract; it is listed from the evidence below.";
}

function liveCheck(c: ContractState, snap: PauSnapshot): string | null {
  if (c.role !== "controller") return null;
  const w = controllerWiring(snap);
  if (!w) return null;
  if (w.proxy && w.rateLimits) return "Live check: the chain shows it holds the CONTROLLER role on the ALM proxy and on the rate limits, which is what makes it the controller.";
  return "Live check fails: it does not hold CONTROLLER on both the ALM proxy and the rate limits (see the wiring pill).";
}

/** The tooltip for a contract's role label; empty for a role this explains nothing about. */
export function roleWhy(c: ContractState, snap: PauSnapshot): string {
  const meaning = MEANING[c.role];
  if (!meaning) return c.atlasDocs?.length ? "the atlas document stating this contract" : "";
  const evidence = (c.evidence ?? []).map((e) => `Evidence: ${e}`);
  return [meaning, source(c), ...evidence, liveCheck(c, snap)].filter(Boolean).join("\n");
}
