// A role disagreement: an atlas-stated Solana Permission the chain says is
// suspended is listed; one still active, or one the atlas does not state, is not.
import { describe, expect, it } from "vitest";
import type { ContractState, StoredPauSnapshot } from "./pau.ts";
import { roleRows } from "./pauAuditRoles.ts";

const perm = (address: string, holds: boolean, atlasDocs?: string[]): ContractState => ({
  role: "permission", address, label: "Primary Relayer", events: 0, historyComplete: false, ...(atlasDocs ? { atlasDocs } : {}),
  roles: [{ role: "permission", account: `${address}-authority`, since: null, name: "RELAYER", holds }],
});
const snap: StoredPauSnapshot = {
  deployment: "keel:solana:svm", prime: "keel", primeName: "Keel", chain: "solana", kind: "svm", fetchedAt: "t",
  contracts: [perm("Suspended1", false, ["doc-a"]), perm("Active1", true, ["doc-b"]), perm("Unstated", false)],
};

describe("roleRows", () => {
  it("lists only an atlas-stated Permission the chain says is suspended, citing the document stating it", () => {
    expect(roleRows([snap])).toEqual([expect.objectContaining({ reason: "role-not-held", group: "registry", label: "RELAYER", stated: "Suspended1-authority", docId: "doc-a", contract: "Suspended1", subject: "Primary Relayer" })]);
  });
});
