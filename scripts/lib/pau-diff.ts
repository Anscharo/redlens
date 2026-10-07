/**
 * Compares atlas PAU observations (pau-discover.ts) with the curated registry,
 * and the observations with each other. Pure; the CLI owns all I/O.
 *
 *   - missing:  the atlas names a PAU address the registry does not hold;
 *   - stale:    a registry member's atlas provenance doc is missing, or
 *               does not carry the member's address;
 *   - conflict: the atlas disagrees with itself (one address under two roles
 *               or two primes) or with the explorer's verified contract name.
 */
import type { AtlasNode } from "../../src/types.ts";
import type { PauMember, PauRegistry, PauRole } from "../../src/lib/pauRegistry.ts";
import { ANY_CHAIN, type PauObservation } from "./pau-discover.ts";

export interface StaleMember {
  prime: string | null;
  chain: string;
  role: PauRole;
  address: string;
  doc: string;
  reason: "doc-removed" | "address-removed";
}

export interface PauConflict {
  address: string;
  reason: "roles" | "primes" | "explorer-name";
  detail: string;
  docs: string[];
}

/** Verified explorer contract names each role is expected to carry. */
export const EXPECTED_NAME: Record<PauRole, RegExp> = {
  controller: /^(?:Mainnet|Foreign)?Controller$/,
  almProxy: /^ALMProxy/,
  rateLimits: /^RateLimits$/,
  accessControls: /^AccessControls$/,
  administeredAgent: /^AdministeredAgent$/,
  beacon: /Beacon$/,
  facet: /Facet$/,
  freezer: /Safe/,
  relayer: /Safe/,
};

const has = (members: PauMember[], o: PauObservation) => members.some((m) => m.role === o.role && m.address === o.address);

function inRegistry(o: PauObservation, reg: PauRegistry): boolean {
  if (!o.prime) return reg.shared.some((s) => s.chain === o.chain && has(s.members, o));
  return reg.deployments.some(
    (d) =>
      d.prime === o.prime &&
      (o.chain === ANY_CHAIN || d.chain === o.chain) &&
      (o.kind === null || d.kind === o.kind) &&
      has(d.members, o),
  );
}

function isIgnored(o: PauObservation, reg: PauRegistry): boolean {
  return reg.ignored.some((g) => g.prime === o.prime && g.chain === o.chain && g.role === o.role && g.address === o.address);
}

/** Atlas observations the registry neither holds nor has ignored. */
export function missingFromRegistry(obs: PauObservation[], reg: PauRegistry): PauObservation[] {
  return obs.filter((o) => !inRegistry(o, reg) && !isIgnored(o, reg));
}

/** Registry members whose atlas provenance doc is missing or does not carry their address. */
export function staleMembers(reg: PauRegistry, docs: Record<string, AtlasNode>): StaleMember[] {
  const groups = [
    ...reg.deployments.map((d) => ({ prime: d.prime as string | null, chain: d.chain, members: d.members })),
    ...reg.shared.map((s) => ({ prime: null, chain: s.chain, members: s.members })),
  ];
  const out: StaleMember[] = [];
  for (const g of groups) {
    for (const m of g.members) {
      for (const p of m.provenance) {
        if (p.source !== "atlas" || !p.doc) continue;
        const doc = docs[p.doc];
        const reason = !doc ? "doc-removed" : doc.addressRefs.includes(m.address) ? null : "address-removed";
        if (reason) out.push({ prime: g.prime, chain: g.chain, role: m.role, address: m.address, doc: p.doc, reason });
      }
    }
  }
  return out;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const t of items) out.set(key(t), [...(out.get(key(t)) ?? []), t]);
  return out;
}

const distinct = (xs: string[]) => [...new Set(xs)];

/** Each role@chain claim on `address` whose verified explorer name contradicts the role. */
function explorerNameConflicts(
  address: string,
  group: PauObservation[],
  explorerName: (address: string, chain: string) => string | undefined,
): PauConflict[] {
  const out: PauConflict[] = [];
  for (const [where, same] of groupBy(group, (o) => `${o.role}@${o.chain}`)) {
    const o = same[0];
    const name = o.chain === ANY_CHAIN ? undefined : explorerName(address, o.chain);
    if (name && !EXPECTED_NAME[o.role].test(name)) {
      const docs = distinct(same.map((s) => s.doc));
      out.push({ address, reason: "explorer-name", detail: `${where} but the explorer names it ${name}`, docs });
    }
  }
  return out;
}

/**
 * Where the atlas disagrees with itself or with the explorer.
 * `explorerName(address, chain)` is the verified contract name on that chain,
 * or undefined when the explorer has no record for it there.
 */
export function atlasConflicts(
  obs: PauObservation[],
  explorerName: (address: string, chain: string) => string | undefined,
): PauConflict[] {
  const out: PauConflict[] = [];
  for (const [address, group] of groupBy(obs, (o) => o.address)) {
    const docs = distinct(group.map((o) => o.doc));
    const roles = distinct(group.map((o) => `${o.role}@${o.chain}`));
    if (distinct(group.map((o) => o.role)).length > 1) out.push({ address, reason: "roles", detail: roles.join(", "), docs });
    const primes = distinct(group.flatMap((o) => (o.prime ? [o.prime] : [])));
    if (primes.length > 1) out.push({ address, reason: "primes", detail: primes.join(", "), docs });
    out.push(...explorerNameConflicts(address, group, explorerName));
  }
  return out;
}
