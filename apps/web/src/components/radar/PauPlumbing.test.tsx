// @vitest-environment jsdom
// The plumbing diagrams: a deployment draws its own generation's, and the change lanes follow the Prime's controllers.
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { CHANGE_PLUMBING, changePlumbings } from "@/lib/pauChangePaths";
import { SVM_CHANGE_PLUMBING } from "@/lib/pauChangePathsSvm";
import { PLUMBING, PLUMBING_NODE_H } from "@/lib/pauPlumbing";
import { PauChangePaths } from "./PauChangePaths";
import { PauPlumbing } from "./PauPlumbing";

afterEach(cleanup);

const anchor = { id: "ethereum", aliases: [] };
const own = (c: HTMLElement) => [...c.querySelectorAll("[data-own]")].map((g) => g.getAttribute("data-node"));

describe("PauPlumbing", () => {
  it("draws a monolithic deployment: each part, an arrow per rule, the optional one dashed", () => {
    const { container } = render(<PauPlumbing kind="monolithic" anchor={anchor} />);
    const p = PLUMBING.monolithic;
    for (const n of p.nodes) expect(container.querySelector(`[data-node="${n.id}"]`)).toHaveTextContent(n.name);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(p.edges.length);
    expect(container.querySelector('[data-edge="freezer-almProxy"] path')).toHaveAttribute("stroke-dasharray");
    expect(container.querySelector('[data-edge="controller-almProxy"] title')).toHaveTextContent("onlyRole(CONTROLLER) on doCall");
    expect(screen.getByRole("heading", { name: "How it fits together" })).toHaveAttribute("id", "ethereum-how-it-fits");
    expect(own(container)).toEqual([]);
  });
  it("draws a Diamond PAU and a Solana controller with the parts only they have", () => {
    const diamond = render(<PauPlumbing kind="diamond" anchor={anchor} />);
    expect(own(diamond.container)).toEqual(["agent", "accessControls", "facets"]);
    expect(diamond.container.querySelector('[data-edge="freezer-agent"]')).toHaveAttribute("data-kind", "stop");
    cleanup();
    const svm = render(<PauPlumbing kind="svm" anchor={{ id: "solana", aliases: [] }} />);
    expect(own(svm.container)).toEqual(["reserve", "permission", "integration"]);
    expect(svm.container.querySelector('[data-edge="freezer-program"] title')).toHaveTextContent("can_freeze_controller");
    expect(svm.container.querySelector('[data-node="almProxy"]')).toBeNull();
  });
  it("names each drawing's arrowheads by its deployment, so two on a page do not share ids", () => {
    const { container } = render(<><PauPlumbing kind="monolithic" anchor={anchor} /><PauPlumbing kind="monolithic" anchor={{ id: "base", aliases: [] }} /></>);
    const ids = [...container.querySelectorAll("marker, title[id]")].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("tags each part and arrow with its link token and scopes the hover rules to a deployment card", () => {
    const { container } = render(<PauPlumbing kind="monolithic" anchor={anchor} />);
    expect(container.querySelector('[data-node="relayer"]')).toHaveAttribute("data-fig", "n:relayer");
    expect(container.querySelector('[data-edge="controller-almProxy"]')).toHaveAttribute("data-fig", "e:controller-almProxy");
    expect(container.querySelector("style")?.textContent).toContain('.pau-deployment:has([data-fig~="n:relayer"]:hover) [data-link~="n:relayer"]');
  });
});

describe("PauChangePaths", () => {
  it("draws the EVM lanes for EVM controllers, linking to the change history", () => {
    const { container } = render(<PauChangePaths kinds={["monolithic", "diamond"]} />);
    expect([...container.querySelectorAll("[data-lane]")].map((g) => g.getAttribute("data-lane"))).toEqual(["By spell", "By spell", "Without a spell", "Emergency"]);
    for (const to of ["anything", "limits", "relayers"]) expect(container.querySelector(`[data-edge$="-${to}"]`)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Change history" })).toHaveAttribute("href", "#change-history");
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });
  it("adds the Solana lanes for a Prime that also runs a Solana controller, each titled", () => {
    const { container } = render(<PauChangePaths kinds={["monolithic", "svm"]} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["EVM chains", "Solana"]);
    expect(container.querySelector('[data-change-paths="pau-change-paths-svm"] [data-node="receiver"]')).toHaveTextContent("Governance program");
  });
  it("draws nothing for a Prime with no deployment read", () => {
    expect(changePlumbings([])).toEqual([]);
    expect(render(<PauChangePaths kinds={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("plumbing data", () => {
  it.each(Object.entries({ ...PLUMBING, changes: CHANGE_PLUMBING, svmChanges: SVM_CHANGE_PLUMBING }))("%s joins only parts it draws, inside the view", (_kind, p) => {
    const ids = new Set(p.nodes.map((n) => n.id));
    for (const e of p.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    for (const n of p.nodes) expect(n.x + n.w <= p.w && n.y + (n.h ?? PLUMBING_NODE_H) <= p.h).toBe(true);
  });
});
