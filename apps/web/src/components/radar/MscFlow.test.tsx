// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { layoutMscFlow, GROUP_HEADING_SIZE, HEADER_SIZE } from "../../lib/mscFlowLayout";
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
  it("hangs the demand-side sources off a Sky node in the left gutter, so Sky is at both ends", () => {
    const flows = [flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 36_231, demandParts: { agentRate: 32_004, distributionRewards: 4_227 } })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$0" />);
    const node = container.querySelector(".msc-flow-sky-source")!;
    expect(node).toBeInTheDocument();
    // In Sky's own blue like the bar on the right, and with NO label of its
    // own: a second "Sky | …" line sat in the line-item column and read as a
    // fourth source. The group heading carries the name and the total.
    expect(node).toHaveTextContent("");
    expect(node.querySelector("text")).toBeNull();
    expect(screen.getByText("OWED BY SKY | $36k")).toBeInTheDocument();
    expect(node.querySelector("rect.msc-ring-sky-wedge")).toHaveStyle({ fill: "var(--msc-sky)" });
    // One ribbon per demand-side source, in that source's own fill.
    expect([...node.querySelectorAll("path.msc-ring-slice")].map((p) => p.getAttribute("class"))).toEqual([
      "msc-ring-slice msc-ring-agentRate",
      "msc-ring-slice msc-ring-distributionRewards",
    ]);
    // It sits left of the source bars it feeds.
    const srcX = Number(container.querySelector('.msc-flow-source[data-kind="agentRate"] rect')!.getAttribute("x"));
    expect(Number(node.querySelector("rect")!.getAttribute("x"))).toBeLessThan(srcX);
  });

  it("draws no left-hand Sky node in a month with no demand side", () => {
    const flows = [flow({ demand: 0, demandParts: {} })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$10.00M" />);
    expect(container.querySelector(".msc-flow-sky-source")).not.toBeInTheDocument();
    expect(screen.queryByText("OWED BY SKY")).not.toBeInTheDocument();
  });

  it("speaks the orbit's mark vocabulary, so the key, hover and pills carry over", () => {
    const flows = [flow(), flow({ prime: "grove", sky: 5_000_000, cof: 5_000_000, sde: 0, kept: 1_000_000, demand: 0, demandParts: {} })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$15.00M" />);
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026").tagName).toBe("FIGURE");
    expect(container.querySelector("svg.msc-ring.msc-flow")).toBeInTheDocument();
    // One mark per line item, the ribbon in the item's own fill class.
    expect(container.querySelector('.msc-ring-prime[data-prime="spark"] .msc-ring-mark[data-mark="spark::cof"] path.msc-ring-slice.msc-ring-cof')).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::agentRate"] path.msc-ring-agentRate')).toBeInTheDocument();
    // No stubs: a mark is its ribbon and nothing else.
    expect(container.querySelector("rect.msc-flow-stub")).not.toBeInTheDocument();
    // Column headers over the three node groups — bigger than the group caption.
    expect(screen.getByText("SOURCE")).toHaveAttribute("font-size", String(HEADER_SIZE));
    expect(screen.getByText("PRIME")).toHaveAttribute("font-size", String(HEADER_SIZE));
    expect(screen.getByText("SKY")).toHaveAttribute("font-size", String(HEADER_SIZE));
    expect(screen.getByText("EARNED IN THE PRIME'S ALLOCATION SYSTEM")).toHaveAttribute("font-size", String(GROUP_HEADING_SIZE));
    // The Sky group's heading carries its total, so the node needs no label.
    expect(screen.getByText(/^OWED BY SKY \| \$/)).toBeInTheDocument();
    expect(container.querySelector('.msc-flow-source[data-kind="kept"][data-origin="earned"]')).toBeInTheDocument();
    expect(container.querySelector('.msc-flow-source[data-kind="agentRate"][data-origin="sky"]')).toBeInTheDocument();
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
    expect(screen.getByText("CoF · earned toward cost of funds")).toBeInTheDocument();
    expect(screen.getByText("supply-side kept")).toBeInTheDocument();
    // The Prime links to its page with the same accessible name as the orbit.
    expect(screen.getByRole("link", { name: /^Spark, Jul 2026: owed Sky \$10.00M/ })).toHaveAttribute("href", "/radar/spark-party/settlements");
    // Generated hover rules: focus on a Prime fades the rest.
    const style = container.querySelector("style")!.textContent!;
    expect(style).toContain('.msc-ring-mark[data-mark="spark::share"]:hover');
    expect(style).toContain('.msc-ring-pill[data-mark="grove::kept"] { opacity: 1; }');
  });

  it("carries a supply-side loss on the gross pill instead of drawing a gap", () => {
    const flows = [flow({ prime: "grove", sky: 3_000_000, cof: 3_000_000, sde: 0, kept: -1_000_000, demand: 100_000, demandParts: { agentRate: 100_000 } })];
    const { container } = render(<MscFlow layout={layoutMscFlow(flows)} primes={primes(flows)} month="2026-07" centerFigure="$3.00M" />);
    expect(container.querySelector(".msc-ring-hole")).not.toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="grove::loss"]')).not.toBeInTheDocument();
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
