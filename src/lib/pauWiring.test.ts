// A controller is judged only from complete role histories with every live
// check read; it is wired on a side when it holds CONTROLLER on any contract there.
import { describe, expect, it } from "vitest";
import type { ContractState, PauSnapshot } from "./pau.ts";
import { controllerWiring } from "./pauWiring.ts";

const CTRL = "0x" + "C".repeat(40);
const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const grant = (account: string, holds: boolean | null = true) => ({ role: "0xr", name: "CONTROLLER", account, since: at, holds });
const c = (role: ContractState["role"], roles: ReturnType<typeof grant>[] = [], historyComplete = true): ContractState => ({ role, address: "0x" + role.length.toString(16).repeat(40).slice(0, 40), roles, events: 1, historyComplete });
const snap = (...contracts: ContractState[]): PauSnapshot => ({ deployment: "d", prime: "p", primeName: "P", chain: "plasma", kind: "monolithic", contracts: [{ ...c("controller"), address: CTRL }, ...contracts] });

describe("controllerWiring", () => {
  it("finds the controller's CONTROLLER grant on either side, ignoring other accounts' and revoked grants", () => {
    const me = CTRL.toLowerCase();
    expect(controllerWiring(snap(c("almProxy", [grant(me)]), c("rateLimits", [grant(me)])))).toEqual({ proxy: true, rateLimits: true });
    expect(controllerWiring(snap(c("almProxy"), c("rateLimits")))).toEqual({ proxy: false, rateLimits: false });
    expect(controllerWiring(snap(c("almProxy", [grant("0x" + "1".repeat(40))]), c("rateLimits", [grant(me)])))).toEqual({ proxy: false, rateLimits: true });
    expect(controllerWiring(snap(c("almProxy", [grant(me, false)]), c("almProxy", [grant(me)]), c("rateLimits", [grant(me, false)])))).toEqual({ proxy: true, rateLimits: false });
  });
  it("says nothing without a controller, a proxy and rate limits, or before every role is read", () => {
    expect(controllerWiring({ ...snap(c("almProxy"), c("rateLimits")), contracts: [c("almProxy"), c("rateLimits")] })).toBeNull();
    expect(controllerWiring(snap(c("rateLimits")))).toBeNull();
    expect(controllerWiring(snap(c("almProxy"), c("rateLimits", [], false)))).toBeNull();
    expect(controllerWiring(snap(c("almProxy", [grant("0x" + "1".repeat(40), null)]), c("rateLimits")))).toBeNull();
  });
});
