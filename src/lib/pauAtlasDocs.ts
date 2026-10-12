// The atlas documents behind each contract of a served PAU snapshot: the
// registry's atlas provenance (src/data/pau-registry.json) for that address,
// from the deployment's own members and its chain's shared contracts. Attached
// when GET /api/pau serves the snapshots, so a registry edit shows without the
// worker re-reading the chain. Pure.
import type { PauSnapshot } from "./pau.ts";
import type { PauMember, PauRegistry } from "./pauRegistry.ts";

const atlasDocs = (m: PauMember) => m.provenance.flatMap((p) => (p.source === "atlas" && p.doc ? [p.doc] : []));

/** Each address's atlas doc ids for one snapshot, deployment members first, then the chain's shared contracts. */
export function atlasDocsByAddress(reg: PauRegistry, snap: Pick<PauSnapshot, "prime" | "chain" | "kind">): Map<string, string[]> {
  const own = reg.deployments.find((d) => d.prime === snap.prime && d.chain === snap.chain && d.kind === snap.kind)?.members ?? [];
  const shared = reg.shared.find((s) => s.chain === snap.chain)?.members ?? [];
  const out = new Map<string, string[]>();
  for (const m of [...own, ...shared]) {
    const docs = atlasDocs(m);
    const key = m.address.toLowerCase();
    if (docs.length) out.set(key, [...new Set([...(out.get(key) ?? []), ...docs])]);
  }
  return out;
}

/** The snapshots with each contract's `atlasDocs` set where the registry cites an atlas document for it. */
export function withAtlasDocs<T extends PauSnapshot>(snaps: T[], reg: PauRegistry): T[] {
  return snaps.map((s) => {
    const docs = atlasDocsByAddress(reg, s);
    return { ...s, contracts: s.contracts.map((c) => (docs.has(c.address.toLowerCase()) ? { ...c, atlasDocs: docs.get(c.address.toLowerCase()) } : c)) };
  });
}
