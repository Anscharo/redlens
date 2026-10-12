// What to call the account in a role-holder row: a contract of this PAU by its
// role ("Controller"), else the part its own grants prove ("Relayer" for an
// account holding RELAYER on the controller, or an AdministeredAgent actor;
// "Freezer" likewise), else nothing. A grant the chain denies names no one.
// Pure.
import type { PauSnapshot } from "./pau.ts";
import { holderRows } from "./pauView.ts";

/** The label a contract carries in the deployment's contract list and as a holder. */
export const PAU_ROLE_LABEL: Record<string, string> = {
  controller: "Controller",
  almProxy: "ALM proxy",
  rateLimits: "Rate limits",
  accessControls: "AccessControls",
  administeredAgent: "AdministeredAgent",
};

const PART: Record<string, string> = { RELAYER: "Relayer", actor: "Relayer", FREEZER: "Freezer", revoker: "Freezer" };

/** Lowercase account address to its name in this deployment; an unnamed account is absent. */
export function holderNames(snap: PauSnapshot): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of holderRows(snap)) {
    const part = r.status === "holds" ? PART[r.name] : undefined;
    if (part && !out.has(r.account.toLowerCase())) out.set(r.account.toLowerCase(), part);
  }
  for (const c of snap.contracts) {
    if (PAU_ROLE_LABEL[c.role]) out.set(c.address.toLowerCase(), PAU_ROLE_LABEL[c.role]);
  }
  return out;
}
