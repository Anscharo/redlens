// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { layoutMscFlow } from "../../lib/mscFlowLayout";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import { MscFlow } from "./MscFlow";
import type { OverviewPrime } from "./MscRingPrime";

const flow = (over: Partial<PrimeFlowTotals> = {}): PrimeFlowTotals => ({
  prime: "spark",
  month: "2026-07",
  sky: 10_000_000,
  kept: 2_000_000,
  demand: 1_500_000,
  cof: 9_900_000,
  sde: 100_000,
  demandParts: { agentRate: 1_400_000, distributionRewards: 100_000 },
  latestMonth: "2026-07",
  ...over,
});

function primes(flows: PrimeFlowTotals[]): OverviewPrime[] {
  return flows.map((f) => ({
    flow: f,
    label: f.prime === "spark" ? "Spark" : f.prime,
    bandColor: "var(--msc-prime-1)",
    to: f.prime === "obex" ? null : `/radar/${f.prime}-party/settlements`,
  }));
}

afterEach(cleanup);

describe("MscFlow", () => {
  it("speaks the orbit's mark vocabulary, so the key, hover and pills carry over", () => {
    const flows = [flow(), flow({ prime: "grove", sky: 5_000_000, cof: 5_000_000, sde: 0, kept: 1_000_000, demand: 0, demandParts: {} })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$15.00M" />);
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026").tagName).toBe("FIGURE");
    expect(container.querySelector("svg.msc-ring.msc-flow")).toBeInTheDocument();
    // One mark per line item, the ribbon in the item's own fill class.
    expect(container.querySelector('.msc-ring-prime[data-prime="spark"] .msc-ring-mark[data-mark="spark::cof"] path.msc-ring-slice.msc-ring-cof')).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::agentRate"] path.msc-ring-agentRate')).toBeInTheDocument();
    // What stayed is a stub in the same mark, on the far side of the bar; To-Sky items have none.
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::kept"] rect.msc-flow-stub.msc-ring-kept')).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::cof"] rect.msc-flow-stub')).not.toBeInTheDocument();
    // Sky's column names no Prime; the share pill does.
    expect(container.querySelector('.msc-ring-figure[data-kind="sky"]')).not.toBeInTheDocument();
    // The To-Sky ribbons are one mark (the orbit's arrow), tagged by component.
    const sky = container.querySelector('.msc-ring-mark[data-mark="spark::sky"]')!;
    expect(sky.querySelector("path.msc-ring-arrow.msc-ring-cof[data-cof]")).toBeInTheDocument();
    expect(sky.querySelector("path.msc-ring-arrow.msc-ring-sde[data-sde]")).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="grove::sky"] [data-sde]')).not.toBeInTheDocument();
    // Sky's bar: one wedge group per Prime, colored by type.
    expect(container.querySelectorAll('.msc-ring-mark[data-mark="spark::share"] rect.msc-ring-sky-wedge[data-prime="spark"]')).toHaveLength(2);
    expect(container.querySelectorAll('.msc-ring-mark[data-mark="grove::share"] rect.msc-ring-sky-wedge')).toHaveLength(1);
    // Pills name the number; the To-Sky pill carries its components.
    expect(screen.getByText("$9.90M cost of funds → Sky")).toBeInTheDocument();
    expect(screen.getByText("$10.00M to Sky — 74% of Spark's gross revenue*")).toBeInTheDocument();
    expect(screen.getByText("$13.50M gross revenue* of Spark")).toBeInTheDocument();
    expect(screen.getByText("$10.00M to Sky from Spark")).toBeInTheDocument();
    // Pills paint last.
    const kids = [...container.querySelector("svg")!.children];
    expect(kids[kids.length - 1]).toHaveClass("msc-ring-pills");
    // Source bars in the left gutter, named the key's way.
    expect(screen.getByText("CoF · cost of funds")).toBeInTheDocument();
    expect(screen.getByText("supply-side kept")).toBeInTheDocument();
    // The Prime links to its page with the same accessible name as the orbit.
    expect(screen.getByRole("link", { name: /Spark, Jul 2026: \$10.00M to Sky \(74% of its gross revenue\)/ })).toHaveAttribute("href", "/radar/spark-party/settlements");
    // Generated hover rules: focus on a Prime fades the rest.
    const style = container.querySelector("style")!.textContent!;
    expect(style).toContain('.msc-ring-mark[data-mark="spark::share"]:hover');
    expect(style).toContain('.msc-ring-pill[data-mark="grove::kept"] { opacity: 1; }');
  });

  it("draws a supply-side loss as a striped gap on the Prime's in side", () => {
    const flows = [flow({ prime: "grove", sky: 3_000_000, cof: 3_000_000, sde: 0, kept: -1_000_000, demand: 100_000, demandParts: { agentRate: 100_000 } })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$3.00M" />);
    const gap = container.querySelector('.msc-ring-mark[data-mark="grove::loss"] rect.msc-ring-hole')!;
    expect(gap).toHaveAttribute("fill", "url(#msc-ring-neg-kept)");
    expect(container.querySelector("defs pattern#msc-ring-neg-kept")).toBeInTheDocument();
    expect(screen.getByText("−$1.00M supply-side loss")).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="grove::kept"]')).not.toBeInTheDocument();
  });

  it("renders an unmatched Prime unlinked", () => {
    const flows = [flow({ prime: "obex" })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$10.00M" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector('.msc-ring-prime[data-prime="obex"] rect.msc-flow-agent')).toBeInTheDocument();
  });
});
