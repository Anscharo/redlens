// The role tooltip says what the role does, who vouches for the contract, and
// for a controller what the chain's grants say.
import { describe, expect, it } from "vitest";
import type { ContractState, PauSnapshot } from "./pau.ts";
import { roleWhy } from "./pauRoleWhy.ts";

const CTRL = "0x" + "c".repeat(40);
const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const grant = { role: "0xr", name: "CONTROLLER", account: CTRL, since: at, holds: true };
const c = (role: ContractState["role"], extra: Partial<ContractState> = {}): ContractState => ({ role, address: role === "controller" ? CTRL : "0x" + "1".repeat(40), events: 1, historyComplete: true, ...extra });
const snap = (...contracts: ContractState[]): PauSnapshot => ({ deployment: "d", prime: "p", primeName: "P", chain: "plasma", kind: "monolithic", contracts });

describe("roleWhy", () => {
  it("says a controller with no atlas document is listed from its evidence, and the chain confirms it", () => {
    const ctrl = c("controller", { evidence: ["Holds CONTROLLER on both (granted 2025-12-01)."] });
    const out = roleWhy(ctrl, snap(ctrl, c("almProxy", { roles: [grant] }), c("rateLimits", { roles: [grant] })));
    expect(out).toContain("No atlas document states this contract");
    expect(out).toContain("Evidence: Holds CONTROLLER on both (granted 2025-12-01).");
    expect(out).toContain("Live check: the chain shows it holds the CONTROLLER role");
  });
  it("counts the atlas documents and reports a failed live check", () => {
    const ctrl = c("controller", { atlasDocs: ["a", "b"] });
    const out = roleWhy(ctrl, snap(ctrl, c("almProxy", { roles: [] }), c("rateLimits", { roles: [grant] })));
    expect(out).toContain("Stated by 2 atlas documents");
    expect(out).toContain("Live check fails");
  });
  it("makes no live claim before the roles are read, and nothing for a role it does not explain", () => {
    const ctrl = c("controller");
    expect(roleWhy(ctrl, snap(ctrl))).not.toContain("Live check");
    expect(roleWhy(c("relayer" as never), snap())).toBe("");
  });
});
