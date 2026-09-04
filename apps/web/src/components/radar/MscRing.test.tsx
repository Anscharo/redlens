// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { layoutMscRing } from "../../lib/mscOverviewLayout";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import { MscRing, type MscRingPrime } from "./MscRing";

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

function ringPrimes(flows: PrimeFlowTotals[], month: string): { layout: ReturnType<typeof layoutMscRing>; primes: MscRingPrime[] } {
  const layout = layoutMscRing(flows);
  const primes = layout.primes.map((ring) => {
    const f = flows.find((x) => x.prime === ring.prime)!;
    const linked = f.prime !== "obex"; // obex plays the "no matching actor" prime
    return {
      flow: f,
      ring,
      label: f.prime === "spark" ? "Spark" : f.prime,
      bandColor: "var(--depth-1)",
      to: linked
        ? `/radar/${f.prime}-party/settlements${month !== f.latestMonth ? `?msc=${month}` : ""}`
        : null,
    };
  });
  return { layout, primes };
}

afterEach(cleanup);

describe("MscRing", () => {
  it("links a prime without ?msc when the selected month is its latest", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    const a = screen.getByRole("link", { name: /Spark, Jul 2026/ });
    expect(a).toHaveAttribute("href", "/radar/spark-party/settlements");
  });

  it("carries ?msc when the selected month is older than the prime's latest", () => {
    const f = flow({ latestMonth: "2026-08" });
    const { layout, primes } = ringPrimes([f], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    expect(screen.getByRole("link", { name: /Spark, Jul 2026/ })).toHaveAttribute(
      "href",
      "/radar/spark-party/settlements?msc=2026-07",
    );
  });

  it("renders an unmatched prime unlinked", () => {
    const { layout, primes } = ringPrimes([flow({ prime: "obex" })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector('[data-prime="obex"]')).toBeInTheDocument();
  });

  it("puts the three figures in the aria-label", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    expect(
      screen.getByRole("link", {
        name: "Spark, Jul 2026: $10.00M to Sky (74% of its gross revenue) — $9.90M cost of funds, $100k Sky Direct Exposure; $2.00M supply kept, $1.50M demand-side. Open settlement page.",
      }),
    ).toBeInTheDocument();
  });

  it("names what each hover pill is, not just its number — the arrow is the only mark for To Sky (it's a pass-through, not revenue)", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    // 10M ÷ (10M + 2M + 1.5M) = 74%
    // One arrow pill: both components, then the total with its share.
    expect(screen.getByText("$9.90M cost of funds")).toBeInTheDocument();
    expect(screen.getByText("$100k Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("$10.00M to Sky — 74% of Spark's gross revenue*")).toBeInTheDocument();
    expect(screen.getByText("$13.50M gross revenue* of Spark")).toBeInTheDocument();
    // One pill per slice, named by the workbook's line item.
    expect(screen.getByText("$9.90M cost of funds → Sky")).toBeInTheDocument();
    expect(screen.getByText("$100k Sky Direct Exposure → Sky")).toBeInTheDocument();
    expect(screen.getByText("$2.00M supply kept")).toBeInTheDocument();
    expect(screen.getByText("$1.40M agent rate (demand-side)")).toBeInTheDocument();
    expect(screen.getByText("$100k distribution rewards (demand-side)")).toBeInTheDocument();
  });

  it("fills a negative To-Sky arrow with its category's stripe pattern, not a loss color", () => {
    const { layout, primes } = ringPrimes([flow({ prime: "osero", sky: -497, kept: 107, demand: 12_000 })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="-$497" />,
    );
    expect(container.querySelector('path[fill="url(#msc-ring-neg-sky)"]')).toBeInTheDocument();
    expect(container.querySelector("defs pattern#msc-ring-neg-sky")).toBeInTheDocument();
    // The solid sky class is reserved for positive flows.
    expect(container.querySelector(".msc-ring-sky")).not.toBeInTheDocument();
  });

  it("paints every pill in a top layer, after the last prime — SVG has no z-index", () => {
    const { layout, primes } = ringPrimes([flow(), flow({ prime: "grove", sky: 9_000_000 })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$19.00M" />,
    );
    const kids = [...container.querySelector("svg.msc-ring")!.children];
    // Last child = painted last = on top of every prime, wedge and label.
    expect(kids[kids.length - 1]).toHaveClass("msc-ring-pills");
    expect(kids.some((el) => el.querySelector(".msc-ring-prime"))).toBe(true);
    // Pills are paired to their marks by id, since they no longer nest inside them.
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::kept"] path.msc-ring-kept')).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-pill[data-mark="spark::kept"]')).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::agentRate"] path.msc-ring-agentRate')).toBeInTheDocument();
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::gross"] text.msc-ring-label')).toBeInTheDocument();
  });

  it("gives Sky one wedge per contributing prime, in that prime's own color", () => {
    const { layout, primes } = ringPrimes([flow(), flow({ prime: "grove", sky: 9_000_000 })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$19.00M" />,
    );
    expect(container.querySelectorAll(".msc-ring-sky-wedge")).toHaveLength(2);
    expect(container.querySelector('.msc-ring-sky-wedge[data-prime="spark"]')).toBeInTheDocument();
  });

  it("draws a supply loss as a striped hole in the pie's middle", () => {
    const { layout, primes } = ringPrimes(
      [flow({ prime: "osero", sky: 497, cof: 497, sde: 0, kept: -107, demand: 12_000, demandParts: { agentRate: 12_000 } })],
      "2026-07",
    );
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$497" />,
    );
    expect(screen.getByText("−$107 supply loss — the hole")).toBeInTheDocument();
    const hole = container.querySelector('.msc-ring-mark[data-mark="osero::loss"] circle.msc-ring-hole')!;
    expect(hole).toHaveAttribute("fill", "url(#msc-ring-neg-kept)");
    // No kept slice: the loss lives in the hole.
    expect(container.querySelector('.msc-ring-mark[data-mark="osero::kept"]')).not.toBeInTheDocument();
  });

  it("labels the Sky pie 'To Sky', never 'Sky' alone", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    expect(screen.getByText("To Sky")).toBeInTheDocument();
  });

  it("puts the share in the link's accessible name", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    expect(screen.getByRole("link", { name: /74% of its gross revenue/ })).toBeInTheDocument();
  });
});
