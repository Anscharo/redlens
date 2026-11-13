// Which box or arrow of a deployment's "How it fits together" diagram each
// word of the contract and role lists names, as a link token (`n:<node>`,
// `e:<from>-<to>`), and the stylesheets that light them together on hover. A
// word naming a contract or account links to its box and, by address
// (`a:<address>`), to every other word naming the same one. A grant ("holds
// CONTROLLER") links only to an arrow, and only when the arrow's `grants`
// names that role on that contract and the arrow starts at the holder's box,
// so a grant the diagram does not draw links to nothing. Pure.
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

/** A role-holder row's links, one per part of the row; each names one drawn element or is absent. */
export interface RowLinks {
  /** The box the account is (its name and address). */
  holder?: string;
  /** The arrow the grant makes true (the verb and role name); absent when the diagram draws no arrow for it. */
  grant?: string;
  /** The box of the contract the role is held on (the contract's name after "on"). */
  on?: string;
}

/** For each row of holderRows(snap), the link of each of its parts. */
export function rowLinker(snap: PauSnapshot, p: Plumbing): (r: HolderRow) => RowLinks {
  const names = holderNames(snap);
  return (r) => {
    const from = drawn(p, holderNode(r, snap, names));
    const on = drawn(p, ROLE_NODE[r.on]);
    const grant = `${r.name} on ${r.on}`;
    const edge = r.status === "holds" && from ? p.edges.find((e) => e.from === from && e.grants?.includes(grant)) : undefined;
    return { holder: from && nodeLink(from), grant: edge && edgeLink(edge.from, edge.to), on: on && nodeLink(on) };
  };
}

/** Every link token a diagram draws. */
export const plumbingLinks = (p: Plumbing) => [...p.nodes.map((n) => nodeLink(n.id)), ...p.edges.map((e) => edgeLink(e.from, e.to))];

/**
 * The rules for each token, scoped to a deployment card so two open cards never
 * light each other: hovering a list element marked `data-link` lights the drawn
 * part (`data-fig`) it names, and hovering the part lights it back. A lit
 * element sets `--plumb-lit: 1`, which its own styles read (plumbLitTint).
 */
export function plumbingLinkCss(p: Plumbing): string {
  const card = ".pau-deployment:has(";
  const rules = plumbingLinks(p).map(
    (t) => `${card}[data-link~="${t}"]:is(:hover,:focus-within)) [data-fig~="${t}"],${card}[data-fig~="${t}"]:hover) [data-link~="${t}"]{--plumb-lit:1}`,
  );
  return [".pau-deployment [data-fig]:hover{--plumb-lit:1}", ...rules].join("\n");
}

/** A word naming one account or contract, by its address: every word naming the same one lights with it. */
export const entityLink = (address: string) => `a:${address.toLowerCase()}`;

/** The rules lighting every word that names the same address as the hovered one, within its card. */
export function entityLinkCss(addresses: Iterable<string>): string {
  return [...new Set([...addresses].map(entityLink))]
    .map((t) => `.pau-deployment:has([data-ent~="${t}"]:is(:hover,:focus-within)) [data-ent~="${t}"]{--plumb-lit:1}`)
    .join("\n");
}

/** Styles that follow `--plumb-lit`: an accent tint of the given share, none when unlit. */
export const plumbLitTint = (base: string, share = 10) => `color-mix(in srgb, var(--accent) calc(var(--plumb-lit, 0) * ${share}%), ${base})`;
