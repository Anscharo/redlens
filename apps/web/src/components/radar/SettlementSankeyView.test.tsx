// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { collapseVenues, layoutVenueSankey, type SankeyVenue } from "../../lib/settlementSankey";
import { SettlementSankeyView } from "./SettlementSankeyView";

const v = (over: Partial<SankeyVenue> & { id: string }): SankeyVenue => ({
  label: over.id,
  synthetic: false,
  profitToSky: 0,
  profitToGrove: 0,
  ...over,
});

afterEach(cleanup);

describe("SettlementSankeyView", () => {
  it("stripes a losing ribbon and the out-bar in their series color instead of a loss hue", () => {
    const rows = collapseVenues([
      v({ id: "win", profitToSky: 100, profitToGrove: 40 }),
      v({ id: "lose", profitToSky: 10, profitToGrove: -30 }),
    ]);
    const layout = layoutVenueSankey(rows, "Spark");
    const { container } = render(
      <SettlementSankeyView rows={rows} layout={layout} primeLabel="Spark" primeColor="var(--msc-prime-1)" />,
    );
    // Stripe patterns exist per series, the Prime's in its identity color.
    expect(container.querySelector("pattern#msc-sankey-neg-kept")).toBeInTheDocument();
    const primePattern = container.querySelector("pattern#msc-sankey-neg-prime rect") as SVGElement;
    expect(primePattern.style.fill).toBe("var(--msc-prime-1)");
    // The losing venue's ribbon to the Prime keeps the supply-kept series and is striped.
    expect(container.querySelector('path[data-venue="lose"][fill="url(#msc-sankey-neg-kept)"]')).toBeInTheDocument();
    expect(container.querySelector('path[fill="var(--accent)"]')).not.toBeInTheDocument();
    // In-bars: Sky in blue, the Prime in its identity color; the Prime's out-bar striped in it.
    expect(container.querySelector('.msc-sankey-sink rect[fill="var(--msc-sky)"]')).toBeInTheDocument();
    expect(container.querySelector('.msc-sankey-sink rect[fill="var(--msc-prime-1)"]')).toBeInTheDocument();
    expect(container.querySelector('.msc-sankey-sink rect[fill="url(#msc-sankey-neg-prime)"]')).toBeInTheDocument();
    // …and the key under the chart says what the stripes mean.
    const caption = container.querySelector("figcaption")!;
    expect(caption).toHaveTextContent("striped · a loss, paid back out to the venue");
    expect(caption).toHaveTextContent("to Sky");
    expect(caption).toHaveTextContent("Spark");
  });

  it("names the chart on a figure so the Sky link stays in the accessibility tree", () => {
    const rows = collapseVenues([
      v({ id: "win", profitToSky: 100, profitToGrove: 40 }),
    ]);
    const layout = layoutVenueSankey(rows, "Spark");
    const { container } = render(
      <SettlementSankeyView
        rows={rows}
        layout={layout}
        primeLabel="Spark"
        month="2026-07"
        primeColor="var(--msc-prime-1)"
      />,
    );
    expect(container.querySelector("svg.msc-sankey")).not.toHaveAttribute("role");
    expect(screen.getByLabelText("Venue flows to Sky and Spark").tagName).toBe("FIGURE");
    expect(
      screen.getByRole("link", { name: /ecosystem Monthly Settlement Cycle overview/ }),
    ).toHaveAttribute("href", "/radar?msc=2026-07");
  });
});
