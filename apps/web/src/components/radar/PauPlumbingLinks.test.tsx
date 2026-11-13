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
  it("tags each contract's name, not its address, with its box and its address", () => {
    const { container } = render(<PauContracts snap={snap} />);
    const names = [...container.querySelectorAll("[data-ent]")];
    expect(names.map((n) => [n.textContent, n.getAttribute("data-link"), n.getAttribute("data-ent")])).toEqual([
      ["Controller", "n:controller", `a:${CTRL}`],
      ["ALM proxy (freezable)", "n:almProxy", `a:${FPROXY}`],
    ]);
    expect([...container.querySelectorAll("li")].every((li) => !li.hasAttribute("data-link"))).toBe(true);
  });
  it("links each part of a row to one drawn element: the account and contract names to their boxes, the grant to its arrow", () => {
    const { container } = render(<PauHolders snap={snap} anchor={{ id: "ethereum", aliases: [] }} />);
    const part = (row: Element | undefined, name: string) => row?.querySelector(`[data-part="${name}"]`);
    const rows = [...container.querySelectorAll("li")];
    const relayer = rows.find((li) => li.textContent?.includes("Relayer") && li.textContent.includes("on ALM proxy (freezable)"));
    expect(part(relayer, "holder")).toHaveAttribute("data-link", "n:relayer");
    expect(part(relayer, "holder")).toHaveTextContent(/^Relayer$/);
    expect(part(relayer, "grant")).toHaveTextContent("holds CONTROLLER");
    expect(part(relayer, "grant")).not.toHaveAttribute("data-link");
    expect(part(relayer, "on")).toHaveAttribute("data-link", "n:almProxy");
    expect(part(relayer, "on")).toHaveAttribute("data-ent", `a:${FPROXY}`);
    expect(part(relayer, "on")).toHaveTextContent(/^ALM proxy \(freezable\)$/);
    const ctl = rows.find((li) => li.textContent?.includes("Controller") && li.textContent.includes("CONTROLLER"));
    expect(part(ctl, "holder")).toHaveAttribute("data-ent", `a:${CTRL}`);
    expect(part(ctl, "grant")).toHaveAttribute("data-link", "e:controller-almProxy");
    expect(rows.every((li) => !li.hasAttribute("data-link"))).toBe(true);
  });
});
