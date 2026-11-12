// @vitest-environment jsdom
// The plumbing diagram: each generation's parts and arrows, and the toggle between them.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { PLUMBING, PLUMBING_H, PLUMBING_NODE_H } from "@/lib/pauPlumbing";
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
  it.each(Object.entries(PLUMBING))("%s joins only parts it draws, inside the view", (_kind, p) => {
    const ids = new Set(p.nodes.map((n) => n.id));
    for (const e of p.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    for (const n of p.nodes) expect(n.x + n.w <= p.w && n.y + PLUMBING_NODE_H <= PLUMBING_H).toBe(true);
  });
});
