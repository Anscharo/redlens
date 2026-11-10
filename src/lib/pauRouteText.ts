// The words for who can change a rate limit (pauKeyRoutes.ts), shared by the
// reader's "Atlas vs contract" table, the Radar marks and the PAU values audit.
// What the Operator may do cites the atlas rule it rests on, next to the claim.
// Pure.
import type { KeyRoutes, Reach } from "./pauKeyRoutes.ts";
import { shortAddress } from "./plainCheck.ts";

const when = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

const REACH: Record<Reach["kind"], (r: Reach) => string> = {
  same: () => "already holds it",
  lower: () => "may lower it to that at any time",
  raise: (r) => {
    const x = r as Extract<Reach, { kind: "raise" }>;
    return x.raises === 1 ? `may raise it there in one raise, from ${when(x.first)}` : `may raise it there in ${x.raises} raises a hop apart, from ${when(x.first)} to ${when(x.last)}`;
  },
  beyond: () => "cannot raise it that far (each raise is capped at the current value times maxChange or the key's default), so only a spell can",
  locked: () => "cannot move it: the limit is locked as unlimited",
};

/** Who can set the value, as one clause: a spell through its admins, and what the Operator can do. */
export function routesText(r: KeyRoutes): string {
  const spell = r.admins.length ? `a spell, through ${r.admins.map(shortAddress).join(" or ")}` : "no spell (only the Configurator holds the admin role)";
  if (!r.operator) return `Set by ${spell}; the Operator has no route to this limit`;
  const cite = r.operator.cites?.length ? ` (Atlas ${r.operator.cites.join(", ")})` : "";
  const op = r.operator.reach ? `the Operator ${REACH[r.operator.reach.kind](r.operator.reach)}${cite}` : "the Operator may adjust it, but whether it reaches the stated value is not known (units or bounds not read)";
  return `Set by ${spell}, or through the Configurator, where ${op} (whether a cBEAM is paired and the Configurator is running are not read)`;
}

/** Whether the Operator can bring the limit to the stated value without a spell. */
export const operatorReaches = (r: KeyRoutes | undefined): boolean => !!r?.operator?.reach && ["same", "lower", "raise"].includes(r.operator.reach.kind);

/** Whether the Operator has a route to the limit but cannot bring it to the stated value. */
export const operatorFallsShort = (r: KeyRoutes | undefined): boolean => r?.operator?.reach?.kind === "beyond" || r?.operator?.reach?.kind === "locked";
