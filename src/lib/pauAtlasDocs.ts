// The atlas documents behind each contract of a served PAU snapshot, and the
// registry's other evidence for it: the registry's provenance
// (src/data/pau-registry.json) for that address, from the deployment's own
// members and its chain's shared contracts. Attached
// when GET /api/pau serves the snapshots, so a registry edit shows without the
// worker re-reading the chain. Pure.
import type { PauSnapshot } from "./pau.ts";
import type { PauMember, PauRegistry } from "./pauRegistry.ts";

type Snap = Pick<PauSnapshot, "prime" | "chain" | "kind">;
const atlasDocs = (m: PauMember) => m.provenance.flatMap((p) => (p.source === "atlas" && p.doc ? [p.doc] : []));
const evidence = (m: PauMember) => m.provenance.flatMap((p) => (p.source !== "atlas" && p.note ? [p.note] : []));

/** What `pick` reads from each member of one snapshot, by lowercase address: the deployment's members first, then the chain's shared contracts. */
function byAddress(reg: PauRegistry, snap: Snap, pick: (m: PauMember) => string[]): Map<string, string[]> {
  const own = reg.deployments.find((d) => d.prime === snap.prime && d.chain === snap.chain && d.kind === snap.kind)?.members ?? [];
  const shared = reg.shared.find((s) => s.chain === snap.chain)?.members ?? [];
  const out = new Map<string, string[]>();
  for (const m of [...own, ...shared]) {
    const found = pick(m);
    const key = m.address.toLowerCase();
    if (found.length) out.set(key, [...new Set([...(out.get(key) ?? []), ...found])]);
  }
  return out;
}

/** Each address's atlas doc ids for one snapshot. */
export const atlasDocsByAddress = (reg: PauRegistry, snap: Snap) => byAddress(reg, snap, atlasDocs);

/** Each address's non-atlas provenance notes for one snapshot, in registry order. */
export const evidenceByAddress = (reg: PauRegistry, snap: Snap) => byAddress(reg, snap, evidence);

/** The snapshots with each contract's `atlasDocs` set where the registry cites an atlas document for it, and its `evidence` where it holds other provenance notes. */
export function withAtlasDocs<T extends PauSnapshot>(snaps: T[], reg: PauRegistry): T[] {
  return snaps.map((s) => {
    const docs = atlasDocsByAddress(reg, s);
    const notes = evidenceByAddress(reg, s);
    return {
      ...s,
      contracts: s.contracts.map((c) => {
        const k = c.address.toLowerCase();
        return { ...c, ...(docs.has(k) ? { atlasDocs: docs.get(k) } : {}), ...(notes.has(k) ? { evidence: notes.get(k) } : {}) };
      }),
    };
  });
}
