// The curated PAU registry (src/data/pau-registry.json): which on-chain
// contracts make up each Prime agent's PAU, per chain and controller
// generation. It is the single source for which contracts count as a prime's
// PAU: anything that reads PAU state takes its contract list from here, never
// from the atlas directly. `pnpm pau:candidates` proposes additions and
// conflicts from the atlas and from on-chain wiring, and the pau-triage skill
// decides them.
//
// Primes are keyed by graph entity UUID, never by doc_no (see CLAUDE.md).

import chainRegistry from "../data/chain-registry.json";

/** Monolithic = MainnetController / ForeignController; diamond = Controller + Facets. */
export type PauKind = "monolithic" | "diamond";

export const PAU_ROLES = [
  "controller",
  "almProxy",
  "rateLimits",
  "accessControls",
  "administeredAgent",
  "beacon",
  "facet",
  "beamState",
  "configurator",
  "freezer",
  "relayer",
] as const;
export type PauRole = (typeof PAU_ROLES)[number];

/** Where a registry claim came from. `onchain` = read from the contracts' own wiring. */
export type PauSource = "atlas" | "onchain" | "llm" | "manual";

export interface PauProvenance {
  source: PauSource;
  /** Atlas doc UUID for `atlas` provenance. */
  doc?: string;
  note?: string;
}

export interface PauMember {
  role: PauRole;
  /** Lowercase 0x address. */
  address: string;
  /** Free-text label, e.g. the facet name. */
  label?: string;
  provenance: PauProvenance[];
}

export interface PauDeployment {
  /** Graph entity UUID of the Prime agent. */
  prime: string;
  /** Human-readable only; never used as a key. */
  primeName: string;
  chain: string;
  kind: PauKind;
  members: PauMember[];
}

/** An atlas claim triage rejected, so `pau:candidates` stops proposing it. */
export interface PauIgnored {
  /** Prime entity UUID, or null for a shared-contract claim. */
  prime: string | null;
  chain: string;
  /** Limits the entry to one controller generation; absent covers both. */
  kind?: PauKind;
  role: PauRole;
  address: string;
  reason: string;
}

export interface PauRegistry {
  $comment?: string;
  /** Contracts shared by every diamond PAU (Beacon, facets, BeamState, Configurator), one entry per chain. */
  shared: { chain: string; members: PauMember[] }[];
  deployments: PauDeployment[];
  ignored: PauIgnored[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A chain name the registry does not know has no RPC and never matches an
// atlas observation, so it would fail every check and re-propose every claim.
const KNOWN_CHAINS = new Set<string>(chainRegistry.chains.map((c) => c.chain));
const KINDS = new Set<string>(["monolithic", "diamond"]);
const chainError = (where: string, chain: string) => (KNOWN_CHAINS.has(chain) ? [] : [`${where}: unknown chain "${chain}"`]);
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const SOURCES = new Set<PauSource>(["atlas", "onchain", "llm", "manual"]);
const ROLES = new Set<string>(PAU_ROLES);

function memberErrors(m: PauMember, where: string): string[] {
  const errs: string[] = [];
  if (!ROLES.has(m.role)) errs.push(`${where}: unknown role "${m.role}"`);
  if (!ADDR_RE.test(m.address)) errs.push(`${where}: address must be lowercase 0x hex, got "${m.address}"`);
  if (!m.provenance?.length) errs.push(`${where}: no provenance`);
  for (const p of m.provenance ?? []) {
    if (!SOURCES.has(p.source)) errs.push(`${where}: unknown provenance source "${p.source}"`);
    if (p.source === "atlas" && !(p.doc && UUID_RE.test(p.doc))) errs.push(`${where}: atlas provenance needs a doc UUID`);
  }
  return errs;
}

function deploymentErrors(d: PauDeployment, i: number): string[] {
  const where = `deployments[${i}] (${d.primeName} ${d.chain} ${d.kind})`;
  const errs: string[] = [];
  if (!UUID_RE.test(d.prime)) errs.push(`${where}: prime must be an entity UUID`);
  if (!KINDS.has(d.kind)) errs.push(`${where}: unknown kind "${d.kind}"`);
  errs.push(...chainError(where, d.chain));
  const seen = new Set<string>();
  d.members.forEach((m, j) => {
    errs.push(...memberErrors(m, `${where}.members[${j}]`));
    const key = `${m.role}:${m.address}`;
    if (seen.has(key)) errs.push(`${where}: duplicate member ${key}`);
    seen.add(key);
  });
  const controllers = d.members.filter((m) => m.role === "controller").length;
  if (controllers > 1) errs.push(`${where}: more than one controller`);
  return errs;
}

function ignoredErrors(g: PauIgnored, where: string): string[] {
  const errs = chainError(where, g.chain);
  if (g.prime !== null && !UUID_RE.test(g.prime)) errs.push(`${where}: prime must be an entity UUID or null`);
  if (g.kind !== undefined && !KINDS.has(g.kind)) errs.push(`${where}: unknown kind "${g.kind}"`);
  if (!ADDR_RE.test(g.address)) errs.push(`${where}: address must be lowercase 0x hex`);
  if (!ROLES.has(g.role)) errs.push(`${where}: unknown role "${g.role}"`);
  if (!g.reason?.trim()) errs.push(`${where}: needs a reason`);
  return errs;
}

/** Every structural problem in a registry; empty means valid. */
export function validatePauRegistry(reg: PauRegistry): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  reg.deployments.forEach((d, i) => {
    errs.push(...deploymentErrors(d, i));
    const id = deploymentId(d);
    if (ids.has(id)) errs.push(`deployments[${i}]: duplicate deployment ${id}`);
    ids.add(id);
  });
  reg.shared.forEach((s, i) => {
    errs.push(...chainError(`shared[${i}]`, s.chain));
    s.members.forEach((m, j) => errs.push(...memberErrors(m, `shared[${i}].members[${j}]`)));
  });
  reg.ignored.forEach((g, i) => errs.push(...ignoredErrors(g, `ignored[${i}]`)));
  return errs;
}

/** A deployment's identity: one PAU per prime, chain and controller generation. */
export function deploymentId(d: Pick<PauDeployment, "prime" | "chain" | "kind">): string {
  return `${d.prime}:${d.chain}:${d.kind}`;
}

export function membersOf(d: PauDeployment, role: PauRole): PauMember[] {
  return d.members.filter((m) => m.role === role);
}
