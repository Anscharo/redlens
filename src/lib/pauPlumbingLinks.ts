// Which boxes and arrows of a deployment's "How it fits together" diagram a
// contract or a role-holder row is about, as space-separated link tokens
// (`n:<node>`, `e:<from>-<to>`), and the stylesheet that lights both sides
// when either is hovered. A row lights an arrow only when the arrow's `grants`
// names the row's role on its contract and the arrow starts at the holder's
// box, so a grant the diagram does not draw lights the two boxes alone. Pure.
import type { ContractState, PauSnapshot } from "./pau.ts";
import { holderNames } from "./pauHolderNames.ts";
import type { HolderRow } from "./pauView.ts";
import type { Plumbing } from "./pauPlumbingParts.ts";

/** The box a contract of each role is drawn as; a role absent here has no box. */
export const ROLE_NODE: Partial<Record<ContractState["role"], string>> = {
  controller: "controller",
  almProxy: "almProxy",
  rateLimits: "rateLimits",
  accessControls: "accessControls",
  administeredAgent: "agent",
  facet: "facets",
  beacon: "facets",
  relayer: "relayer",
  freezer: "freezer",
  program: "program",
  reserve: "reserve",
  integration: "integration",
  permission: "permission",
};

/** The box an account named by holderNames, or holding an admin grant, is drawn as. */
const NAME_NODE: Record<string, string> = { Relayer: "relayer", Freezer: "freezer" };
const ADMIN_GRANTS = new Set(["DEFAULT_ADMIN_ROLE", "admin"]);

export const nodeLink = (id: string) => `n:${id}`;
export const edgeLink = (from: string, to: string) => `e:${from}-${to}`;

const drawn = (p: Plumbing, id: string | undefined) => (id && p.nodes.some((n) => n.id === id) ? id : undefined);

/** A contract's link tokens: its own box, when the diagram draws one. */
export function contractLinks(c: Pick<ContractState, "role">, p: Plumbing): string {
  const id = drawn(p, ROLE_NODE[c.role]);
  return id ? nodeLink(id) : "";
}

/** The box the row's account is drawn as: the contract it is, the part its grants prove, or the admin. */
function holderNode(r: HolderRow, snap: PauSnapshot, names: Map<string, string>): string | undefined {
  const account = r.account.toLowerCase();
  const own = snap.contracts.find((c) => c.address.toLowerCase() === account);
  if (own) return ROLE_NODE[own.role];
  const named = names.get(account);
  if (named) return NAME_NODE[named];
  return r.status === "holds" && ADMIN_GRANTS.has(r.name) ? "admin" : undefined;
}

/** For each row of holderRows(snap), the link tokens of the holder's box, the contract's box, and the arrow the grant makes true. */
export function rowLinker(snap: PauSnapshot, p: Plumbing): (r: HolderRow) => string {
  const names = holderNames(snap);
  return (r) => {
    const from = drawn(p, holderNode(r, snap, names));
    const on = drawn(p, ROLE_NODE[r.on]);
    const grant = `${r.name} on ${r.on}`;
    const edge = r.status === "holds" ? p.edges.find((e) => e.from === from && e.grants?.includes(grant)) : undefined;
    return [from && nodeLink(from), on && nodeLink(on), edge && edgeLink(edge.from, edge.to)].filter(Boolean).join(" ");
  };
}

/** Every link token a diagram draws. */
export const plumbingLinks = (p: Plumbing) => [...p.nodes.map((n) => nodeLink(n.id)), ...p.edges.map((e) => edgeLink(e.from, e.to))];

/**
 * One rule pair per token, scoped to a deployment card so two open cards never
 * light each other: hovering a list item (`data-link`) lights the drawn part
 * (`data-fig`), and hovering a drawn part lights itself and the list items.
 * A lit element sets `--plumb-lit: 1`, which its own styles read (plumbLitTint).
 */
export function plumbingLinkCss(p: Plumbing): string {
  const card = ".pau-deployment:has(";
  const pairs = plumbingLinks(p).map(
    (t) => `${card}[data-link~="${t}"]:is(:hover,:focus-within)) [data-fig~="${t}"],${card}[data-fig~="${t}"]:hover) [data-link~="${t}"]{--plumb-lit:1}`,
  );
  return [".pau-deployment [data-fig]:hover{--plumb-lit:1}", ...pairs].join("\n");
}

/** Styles that follow `--plumb-lit`: an accent tint of the given share, none when unlit. */
export const plumbLitTint = (base: string, share = 10) => `color-mix(in srgb, var(--accent) calc(var(--plumb-lit, 0) * ${share}%), ${base})`;
