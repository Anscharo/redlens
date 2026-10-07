/**
 * Folds atlas observations into registry form: one deployment per
 * (prime, chain, generation), shared contracts per chain. It takes pinned
 * observations (pau-diff.ts expandPrimeWide), so a governance multisig arrives
 * already assigned to its deployments. Used for `pau:candidates --draft`,
 * whose output is reviewed by hand (pau-triage skill) before anything reaches
 * the registry.
 */
import { deploymentId, type PauDeployment, type PauMember, type PauRegistry } from "../../src/lib/pauRegistry.ts";
import type { PauObservation } from "./pau-discover.ts";

function addMember(members: PauMember[], o: PauObservation): void {
  const existing = members.find((m) => m.role === o.role && m.address === o.address);
  const prov = { source: "atlas" as const, doc: o.doc };
  if (!existing) members.push({ role: o.role, address: o.address, provenance: [prov] });
  else if (!existing.provenance.some((p) => p.doc === o.doc)) existing.provenance.push(prov);
}

/** Prime observations with a known generation become (or join) their deployment. */
function foldDeployments(draft: PauRegistry, obs: PauObservation[], primeNames: Map<string, string>): void {
  const byId = new Map(draft.deployments.map((d) => [deploymentId(d), d]));
  for (const o of obs) {
    if (!o.prime || o.kind === null) continue; // pinned by expandPrimeWide first
    const key = deploymentId({ prime: o.prime, chain: o.chain, kind: o.kind });
    if (!byId.has(key)) {
      const d: PauDeployment = { prime: o.prime, primeName: primeNames.get(o.prime) ?? "", chain: o.chain, kind: o.kind, members: [] };
      byId.set(key, d);
      draft.deployments.push(d);
    }
    addMember(byId.get(key)!.members, o);
  }
}

function foldShared(draft: PauRegistry, obs: PauObservation[]): void {
  for (const o of obs.filter((x) => !x.prime)) {
    let group = draft.shared.find((s) => s.chain === o.chain);
    if (!group) draft.shared.push((group = { chain: o.chain, members: [] }));
    addMember(group.members, o);
  }
}

/** A registry draft holding every observation, merged onto `base` (kept as-is). */
export function draftRegistry(obs: PauObservation[], primeNames: Map<string, string>, base: PauRegistry): PauRegistry {
  const draft: PauRegistry = structuredClone(base);
  foldDeployments(draft, obs, primeNames);
  foldShared(draft, obs);
  draft.deployments.sort((a, b) => a.primeName.localeCompare(b.primeName) || a.chain.localeCompare(b.chain) || a.kind.localeCompare(b.kind));
  return draft;
}
