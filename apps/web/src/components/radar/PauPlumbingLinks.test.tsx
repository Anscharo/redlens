// @vitest-environment jsdom
// The contract and role lists carry the link tokens that tie each row to the
// diagram, so hovering a row can light the parts it is about.
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { ContractState, StoredPauSnapshot } from "@/lib/pau";
import { PauHolders } from "./ActorPauHolders";
import { PauContracts } from "./PauContracts";

afterEach(cleanup);

const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const [CTRL, FPROXY, RELAYER] = [1, 3, 5].map((n) => "0x" + String(n).repeat(40));
const grant = (name: string, account: string) => ({ role: "0xr", name, account, since: at, holds: true });
const c = (role: ContractState["role"], address: string, roles: ReturnType<typeof grant>[] = [], label?: string): ContractState => ({ role, address, roles, label, events: 1, historyComplete: true });
const snap = { deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", fetchedAt: at.time, contracts: [
  c("controller", CTRL, [grant("RELAYER", RELAYER)]),
  c("almProxy", FPROXY, [grant("CONTROLLER", RELAYER), grant("CONTROLLER", CTRL)], "freezable"),
] } as StoredPauSnapshot;

describe("diagram links on the lists", () => {
  it("tags each contract with its box", () => {
    const { container } = render(<PauContracts snap={snap} />);
    expect([...container.querySelectorAll("li")].map((li) => li.getAttribute("data-link"))).toEqual(["n:controller", "n:almProxy"]);
  });
  it("tags a relayer's CONTROLLER grant on a freezable proxy with its two boxes and no arrow", () => {
    const { container } = render(<PauHolders snap={snap} anchor={{ id: "ethereum", aliases: [] }} />);
    const row = [...container.querySelectorAll("li")].find((li) => li.textContent?.includes("Relayer") && li.textContent.includes("freezable proxy"));
    expect(row).toHaveAttribute("data-link", "n:relayer n:almProxy");
    const ctl = [...container.querySelectorAll("li")].find((li) => li.textContent?.includes("Controller") && li.textContent.includes("CONTROLLER"));
    expect(ctl).toHaveAttribute("data-link", "n:controller n:almProxy e:controller-almProxy");
  });
});
