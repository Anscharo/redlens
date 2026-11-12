// The PAU values audit's role disagreements (pauAuditIndex.ts): an account the
// atlas names to a role that the chain says it does not hold now. Today that is
// a Solana Permission (svm deployments) whose status is Suspended, listed in
// the registry from the atlas document stating it; an EVM role holder is a
// replayed grant rather than an atlas claim, so it is not one. Pure.
import type { StoredPauSnapshot } from "./pau.ts";
import { AUDIT_REASONS } from "./pauAudit.ts";
import type { AuditRow } from "./pauAuditIndex.ts";

/** One row per atlas-stated Permission whose holder the chain says does not hold it. */
export function roleRows(snaps: StoredPauSnapshot[]): AuditRow[] {
  return snaps.flatMap((s) =>
    s.contracts
      .filter((c) => c.role === "permission" && c.atlasDocs?.length)
      .flatMap((c) => (c.roles ?? []).filter((r) => r.holds === false).map((r) => ({ c, r })))
      .map(({ c, r }) => ({
        item: `role:${s.deployment}:${c.address}`, group: AUDIT_REASONS["role-not-held"].group, reason: "role-not-held" as const, note: AUDIT_REASONS["role-not-held"].text,
        primeId: s.prime, prime: s.primeName, chain: s.chain, kind: s.kind, subject: c.label ?? "Atlas role claim", label: r.name ?? r.role, stated: r.account,
        onchain: "suspended", docId: c.atlasDocs![0], key: null, contract: c.address, chainSetAt: null, atlasChangedAt: null, step: null, routes: null,
      })),
  );
}
