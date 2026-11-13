// Each part of a role-holder row links to one drawn element at most: the
// account to the box it is, the grant to the arrow it makes true (only one
// starting at the holder's box), and the contract after "on" to its box. Words
// naming one address light together. Every token the lists carry names a part
// the diagram draws.
import { describe, expect, it } from "vitest";
import type { ContractState, PauSnapshot } from "./pau.ts";
import { PLUMBING } from "./pauPlumbing.ts";
import { ROLE_NODE, contractLinks, entityLinkCss, plumbingLinkCss, plumbingLinks, rowLinker } from "./pauPlumbingLinks.ts";
import { holderRows } from "./pauView.ts";

const at = { block: 1, time: "2026-01-01T00:00:00.000Z", tx: "0xt" };
const [CTRL, PROXY, FPROXY, LIMITS, RELAYER, FREEZER, ADMIN] = [1, 2, 3, 4, 5, 6, 7].map((n) => "0x" + String(n).repeat(40));
const grant = (name: string, account: string, holds: boolean | null = true) => ({ role: "0xr", name, account, since: at, holds });
const c = (role: ContractState["role"], address: string, roles: ReturnType<typeof grant>[] = [], label?: string): ContractState => ({ role, address, roles, label, events: 1, historyComplete: true });
const snap: PauSnapshot = { deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", contracts: [
  c("controller", CTRL, [grant("RELAYER", RELAYER), grant("FREEZER", FREEZER)]),
  c("almProxy", PROXY, [grant("CONTROLLER", CTRL), grant("DEFAULT_ADMIN_ROLE", ADMIN)]),
  c("almProxy", FPROXY, [grant("CONTROLLER", RELAYER), grant("CONTROLLER", CTRL, false), grant("FREEZER", FREEZER)], "freezable"),
  c("rateLimits", LIMITS, [grant("CONTROLLER", CTRL)]),
] };

const linksOf = (s: PauSnapshot) => {
  const link = rowLinker(s, PLUMBING[s.kind]);
  return holderRows(s).map((r) => ({ key: `${r.name} ${r.account.slice(0, 3)} on ${r.contract.slice(0, 3)}`, links: link(r) }));
};
const find = (key: string) => linksOf(snap).find((r) => r.key === key)?.links;

describe("rowLinker", () => {
  it("lights the arrow a grant makes true, from the holder's box", () => {
    expect(find("RELAYER 0x5 on 0x1")).toEqual({ holder: "n:relayer", grant: "e:relayer-controller", on: "n:controller" });
    expect(find("CONTROLLER 0x1 on 0x2")).toEqual({ holder: "n:controller", grant: "e:controller-almProxy", on: "n:almProxy" });
    expect(find("CONTROLLER 0x1 on 0x4")).toEqual({ holder: "n:controller", grant: "e:controller-rateLimits", on: "n:rateLimits" });
    expect(find("FREEZER 0x6 on 0x3")).toEqual({ holder: "n:freezer", grant: "e:freezer-almProxy", on: "n:almProxy" });
    expect(find("DEFAULT_ADMIN_ROLE 0x7 on 0x2")).toEqual({ holder: "n:admin", grant: "e:admin-controller", on: "n:almProxy" });
  });
  it("links the role to no arrow for a grant the diagram does not draw", () => {
    expect(find("CONTROLLER 0x5 on 0x3")).toEqual({ holder: "n:relayer", grant: undefined, on: "n:almProxy" });
  });
  it("links the role to no arrow for a grant the chain denies", () => {
    expect(find("CONTROLLER 0x1 on 0x3")).toEqual({ holder: "n:controller", grant: undefined, on: "n:almProxy" });
  });
  it("links a Diamond relayer and freezer through the AdministeredAgent", () => {
    const agent = { ...c("administeredAgent", "0x" + "8".repeat(40)), agent: { actors: [{ account: RELAYER, since: at, holds: true }], revokers: [{ account: FREEZER, since: at, holds: true }] } };
    const rows = linksOf({ ...snap, kind: "diamond", contracts: [agent] }).map((r) => r.links);
    expect(rows).toEqual([
      { holder: "n:relayer", grant: "e:relayer-agent", on: "n:agent" },
      { holder: "n:freezer", grant: "e:freezer-agent", on: "n:agent" },
    ]);
  });
});

describe("tokens and stylesheet", () => {
  it("every token a contract or row carries names a part its diagram draws", () => {
    const drawn = new Set(plumbingLinks(PLUMBING.monolithic));
    const used = [...linksOf(snap).flatMap((r) => Object.values(r.links).filter((t): t is string => !!t)), ...snap.contracts.map((x) => contractLinks(x, PLUMBING.monolithic))];
    expect(used.filter((t) => !drawn.has(t))).toEqual([]);
  });
  it("gives no box to a contract the diagram does not draw", () => {
    expect(contractLinks({ role: "starGuard" }, PLUMBING.monolithic)).toBe("");
    expect(contractLinks({ role: "facet" }, PLUMBING.monolithic)).toBe("");
    expect(contractLinks({ role: "facet" }, PLUMBING.diamond)).toBe("n:facets");
  });
  it("writes one card-scoped rule pair per drawn part and arrow", () => {
    for (const p of Object.values(PLUMBING)) {
      const css = plumbingLinkCss(p);
      for (const t of plumbingLinks(p)) {
        expect(css).toContain(`.pau-deployment:has([data-link~="${t}"]:is(:hover,:focus-within)) [data-fig~="${t}"]`);
        expect(css).toContain(`.pau-deployment:has([data-fig~="${t}"]:hover) [data-link~="${t}"]{`);
      }
      expect(css.split("\n")).toHaveLength(plumbingLinks(p).length + 1);
    }
  });
  it("every arrow's grant names a contract role whose box the same diagram draws", () => {
    for (const p of Object.values(PLUMBING)) {
      const ids = new Set(p.nodes.map((n) => n.id));
      for (const e of p.edges) {
        for (const g of e.grants ?? []) {
          const on = g.match(/^\S+ on (\S+)$/)?.[1] as ContractState["role"] | undefined;
          expect(on && ids.has(ROLE_NODE[on] ?? ""), `${p.id} ${e.from}-${e.to}: ${g}`).toBe(true);
        }
      }
    }
  });
});

describe("entityLinkCss", () => {
  it("writes one card-scoped rule per address, whatever its case or how often it is named", () => {
    const css = entityLinkCss([CTRL, CTRL.toUpperCase().replace("0X", "0x"), RELAYER]);
    expect(css.split("\n")).toEqual([
      `.pau-deployment:has([data-ent~="a:${CTRL}"]:is(:hover,:focus-within)) [data-ent~="a:${CTRL}"]{--plumb-lit:1}`,
      `.pau-deployment:has([data-ent~="a:${RELAYER}"]:is(:hover,:focus-within)) [data-ent~="a:${RELAYER}"]{--plumb-lit:1}`,
    ]);
  });
});
