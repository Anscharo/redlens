// An account in a role-holder row is named by the contract it is, else by the
// part its own held grants prove; a denied grant names no one.
import { describe, expect, it } from "vitest";
import type { ContractState, PauSnapshot } from "./pau.ts";
import { contractLabel, holderNames } from "./pauHolderNames.ts";

const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const [CTRL, PROXY, RELAYER, FROZEN, STRANGER, EX_RELAYER] = [1, 2, 3, 4, 5, 6].map((n) => "0x" + String(n).repeat(40));
const grant = (name: string, account: string, holds: boolean | null = true) => ({ role: "0xr", name, account, since: at, holds });
const c = (role: ContractState["role"], address: string, roles: ReturnType<typeof grant>[] = []): ContractState => ({ role, address, roles, events: 1, historyComplete: true });
const snap: PauSnapshot = { deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", contracts: [
  c("controller", CTRL, [grant("RELAYER", RELAYER), grant("RELAYER", EX_RELAYER, false), grant("FREEZER", FROZEN)]),
  c("almProxy", PROXY, [grant("CONTROLLER", CTRL), grant("CONTROLLER", RELAYER), grant("DEFAULT_ADMIN_ROLE", STRANGER)]),
] };

describe("holderNames", () => {
  it("names this deployment's own contracts, and relayers and freezers by the grants the chain confirms", () => {
    const names = holderNames(snap);
    expect(names.get(CTRL)).toBe("Controller");
    expect(names.get(PROXY)).toBe("ALM proxy");
    expect(names.get(RELAYER)).toBe("Relayer");
    expect(names.get(FROZEN)).toBe("Freezer");
  });
  it("leaves an account unnamed when nothing proves its part, or the chain denies the grant", () => {
    const names = holderNames(snap);
    expect(names.has(STRANGER)).toBe(false);
    expect(names.has(EX_RELAYER)).toBe(false);
  });
  it("tells a freezable ALM proxy from a plain one", () => {
    const freezable = { ...c("almProxy", "0x" + "9".repeat(40)), label: "freezable" };
    expect(contractLabel(freezable)).toBe("ALM proxy (freezable)");
    expect(contractLabel(c("almProxy", PROXY))).toBe("ALM proxy");
    expect(holderNames({ ...snap, contracts: [...snap.contracts, freezable] }).get(freezable.address)).toBe("ALM proxy (freezable)");
  });
});
