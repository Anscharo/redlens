// @vitest-environment jsdom
// The plumbing diagram: every part drawn once, every arrow between drawn parts and carrying its contract rule.
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { PLUMBING_EDGES, PLUMBING_NODES, PLUMBING_VIEW } from "@/lib/pauPlumbing";
import { PauPlumbing } from "./PauPlumbing";

describe("PauPlumbing", () => {
  it("draws each part and an arrow per rule, the optional one dashed", () => {
    const { container } = render(<PauPlumbing />);
    for (const n of PLUMBING_NODES) expect(container.querySelector(`[data-node="${n.id}"]`)).toHaveTextContent(n.name);
    expect(container.querySelectorAll("[data-edge]")).toHaveLength(PLUMBING_EDGES.length);
    expect(container.querySelector('[data-edge="freezer-almProxy"] path')).toHaveAttribute("stroke-dasharray");
    expect(container.querySelector('[data-edge="controller-almProxy"] title')).toHaveTextContent("onlyRole(CONTROLLER) on doCall");
    expect(container.querySelector("section")).toHaveAttribute("aria-labelledby", "how-it-fits");
  });
  it("joins only parts it draws, inside the view", () => {
    const ids = new Set(PLUMBING_NODES.map((n) => n.id));
    for (const e of PLUMBING_EDGES) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    for (const n of PLUMBING_NODES) expect(n.x + n.w <= PLUMBING_VIEW.w && n.y + PLUMBING_VIEW.nodeH <= PLUMBING_VIEW.h).toBe(true);
  });
});
