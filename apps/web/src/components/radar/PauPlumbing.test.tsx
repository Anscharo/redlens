// @vitest-environment jsdom
// The plumbing diagram: each generation's parts and arrows, and the toggle between them.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { CHANGE_PLUMBING } from "@/lib/pauChangePaths";
import { PLUMBING, PLUMBING_NODE_H } from "@/lib/pauPlumbing";
import { PauChangePaths } from "./PauChangePaths";
import { PauPlumbing } from "./PauPlumbing";

afterEach(cleanup);

describe("PauPlumbing", () => {
  it("draws the monolithic controller first: each part, an arrow per rule, the optional one dashed", () => {
    const { container } = render(<PauPlumbing />);
    const p = PLUMBING.monolithic;
    for (const n of p.nodes) expect(container.querySelector(`[data-node="${n.id}"]`)).toHaveTextContent(n.name);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(p.edges.length);
    expect(container.querySelector('[data-edge="freezer-almProxy"] path')).toHaveAttribute("stroke-dasharray");
    expect(container.querySelector('[data-edge="controller-almProxy"] title')).toHaveTextContent("onlyRole(CONTROLLER) on doCall");
    expect(container.querySelector("section")).toHaveAttribute("aria-labelledby", "how-it-fits");
    expect(container.querySelector("[data-own]")).toBeNull();
  });
  it("flips to the Diamond PAU, marking the parts only it has", () => {
    const { container } = render(<PauPlumbing />);
    fireEvent.click(screen.getByRole("button", { name: "Diamond PAU" }));
    expect(screen.getByRole("button", { name: "Diamond PAU" })).toHaveAttribute("aria-pressed", "true");
    expect([...container.querySelectorAll("[data-own]")].map((g) => g.getAttribute("data-node"))).toEqual(["agent", "accessControls", "facets"]);
    expect(container.querySelector('[data-edge="freezer-agent"]')).toHaveAttribute("data-kind", "stop");
    expect(container.querySelector('[data-edge="freezer-relayer"]')).toBeNull();
  });
  it("draws the change paths as lanes, each ending inside the PAU", () => {
    const { container } = render(<PauChangePaths />);
    expect([...container.querySelectorAll("[data-lane]")].map((g) => g.getAttribute("data-lane"))).toEqual(["By spell", "By spell", "Without a spell", "Emergency"]);
    for (const to of ["anything", "limits", "relayers"]) expect(container.querySelector(`[data-edge$="-${to}"]`)).not.toBeNull();
    expect(container.querySelector('[data-edge="freezer-relayers"]')).toHaveAttribute("data-kind", "stop");
    expect(screen.getByRole("link", { name: "Change history" })).toHaveAttribute("href", "#change-history");
  });
  it.each(Object.entries({ ...PLUMBING, changes: CHANGE_PLUMBING }))("%s joins only parts it draws, inside the view", (_kind, p) => {
    const ids = new Set(p.nodes.map((n) => n.id));
    for (const e of p.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    for (const n of p.nodes) expect(n.x + n.w <= p.w && n.y + (n.h ?? PLUMBING_NODE_H) <= p.h).toBe(true);
  });
});
