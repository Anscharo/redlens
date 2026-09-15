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
  it("names the chart on a figure so prime links stay in the accessibility tree", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />,
    );
    expect(container.querySelector("svg.msc-ring")).not.toHaveAttribute("role");
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026").tagName).toBe("FIGURE");
    expect(screen.getByRole("link", { name: /Spark, Jul 2026/ })).toBeInTheDocument();
  });

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

  it("names both directions in the aria-label: what it owed Sky, and what it received", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    expect(
      screen.getByRole("link", {
        name: "Spark, Jul 2026: owed Sky $10.00M — $9.90M cost of funds, $100k Sky Direct Exposure; received $3.50M — $2.00M supply-side kept, $1.50M demand-side from Sky. Open settlement page.",
      }),
    ).toBeInTheDocument();
  });

  it("names what each hover pill is, not just its number — the arrow is the only mark for To Sky (it's a pass-through, not revenue)", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    // One arrow pill per lane: the To-Sky total with its two components,
    // and the demand-side total Sky owes back.
    expect(screen.getByText("$9.90M cost of funds")).toBeInTheDocument();
    expect(screen.getByText("$100k Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("$10.00M to Sky")).toBeInTheDocument();
    expect(screen.getByText("$1.50M demand-side, from Sky to Spark")).toBeInTheDocument();
    // The pie's total is what it RECEIVED — no gross-revenue figure anywhere.
    expect(screen.getByText("$3.50M received by Spark — supply-side kept + demand-side")).toBeInTheDocument();
    expect(screen.queryByText(/gross revenue/)).not.toBeInTheDocument();
    // Cost of funds and SDE are Sky's receipts, so they are not slices here.
    expect(screen.queryByText("$9.90M cost of funds → Sky")).not.toBeInTheDocument();
    expect(screen.getByText("$2.00M supply-side kept")).toBeInTheDocument();
    expect(screen.getByText("$1.40M agent rate (demand-side)")).toBeInTheDocument();
    expect(screen.getByText("$100k distribution rewards (demand-side)")).toBeInTheDocument();
  });

  it("fills a negative To-Sky arrow with its category's stripe pattern, not a loss color", () => {
    const { layout, primes } = ringPrimes([flow({ prime: "osero", sky: -497, kept: 107, demand: 12_000 })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="-$497" />,
    );
    expect(container.querySelector('path[fill="url(#msc-ring-loss)"]')).toBeInTheDocument();
    expect(container.querySelector("defs pattern#msc-ring-loss")).toBeInTheDocument();
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
    expect(container.querySelector('.msc-ring-mark[data-mark="spark::received"] text.msc-ring-label')).toBeInTheDocument();
  });

  it("gives Sky one wedge per contributing prime, split by cost of funds and SDE", () => {
    const { layout, primes } = ringPrimes([flow(), flow({ prime: "grove", sky: 9_000_000 })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$19.00M" />,
    );
    // One group per contributing Prime…
    expect(container.querySelectorAll('.msc-ring-mark[data-mark$="::share"]')).toHaveLength(2);
    expect(container.querySelector('.msc-ring-sky-wedge[data-prime="spark"]')).toBeInTheDocument();
    // …each split into the cost of funds and SDE it is made of.
    const spark = container.querySelector('.msc-ring-mark[data-mark="spark::share"]')!;
    expect([...spark.querySelectorAll(".msc-ring-sky-wedge")].map((w) => w.getAttribute("data-kind"))).toEqual([
      "cof",
      "sde",
    ]);
  });

  it("draws a supply loss as a striped hole in the pie's middle", () => {
    const { layout, primes } = ringPrimes(
      [flow({ prime: "osero", sky: 497, cof: 497, sde: 0, kept: -107, demand: 12_000, demandParts: { agentRate: 12_000 } })],
      "2026-07",
    );
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$497" />,
    );
    expect(screen.getByText("−$107 supply-side loss")).toBeInTheDocument();
    const hole = container.querySelector('.msc-ring-mark[data-mark="osero::loss"] circle.msc-ring-hole')!;
    expect(hole).toHaveAttribute("fill", "url(#msc-ring-loss)");
    // No kept slice: the loss lives in the hole.
    expect(container.querySelector('.msc-ring-mark[data-mark="osero::kept"]')).not.toBeInTheDocument();
  });

  it("tags each arrow with the To-Sky components it actually carries, so the key's SDE row lights only those", () => {
    const { layout, primes } = ringPrimes(
      [flow(), flow({ prime: "grove", sky: 5_000_000, cof: 5_000_000, sde: 0 })],
      "2026-07",
    );
    const { container } = render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$15.00M" />);
    const spark = container.querySelector('.msc-ring-mark[data-mark="spark::sky"] .msc-ring-arrow')!;
    const grove = container.querySelector('.msc-ring-mark[data-mark="grove::sky"] .msc-ring-arrow')!;
    expect(spark).toHaveAttribute("data-cof", "true");
    expect(spark).toHaveAttribute("data-sde", "true");
    expect(grove).toHaveAttribute("data-cof", "true");
    expect(grove).not.toHaveAttribute("data-sde");
    // A Sky wedge's figure names its prime, so it can fade with the wedge.
    for (const f of container.querySelectorAll('.msc-ring-figure[data-kind="sky"]')) {
      expect(f.getAttribute("data-prime")).toBeTruthy();
    }
    // Focus on a prime fades every other prime, the Sky disc and the other
    // wedges; hovering its Sky wedge counts as focus too.
    const style = container.querySelector("style")!.textContent!;
    expect(style).toContain('.msc-ring-prime[data-prime="spark"]:hover, a:focus-visible > .msc-ring-prime[data-prime="spark"], .msc-ring-mark[data-mark="spark::share"]:hover');
    expect(style).toContain('.msc-ring-prime:not([data-prime="spark"]), .msc-ring-sky-disc, .msc-ring-sky-wedge:not([data-prime="spark"])');
    expect(style).toContain('.msc-ring-pill[data-mark="grove::kept"] { opacity: 1; }');
  });

  it("labels the Sky pie 'To Sky', never 'Sky' alone", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    expect(screen.getByText("To Sky")).toBeInTheDocument();
  });

  it("draws a second arrow from Sky to the Prime for the demand side", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    const { container } = render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    const inbound = container.querySelector('.msc-ring-mark[data-mark="spark::demand"] path.msc-ring-demand-arrow');
    expect(inbound).toBeInTheDocument();
    // Its own lane, distinct from the To-Sky arrow's path.
    const outbound = container.querySelector('.msc-ring-mark[data-mark="spark::sky"] path.msc-ring-arrow')!;
    expect(inbound!.getAttribute("d")).not.toBe(outbound.getAttribute("d"));
    expect(container.querySelector('.msc-ring-pill[data-mark="spark::demand"]')).toBeInTheDocument();
  });

  it("draws the prime's identity as its rim only and tags each figure with its slice kind", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    const { container } = render(<MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />);
    const rim = container.querySelector(".msc-ring-rim") as SVGElement;
    expect(rim.style.stroke).toBe("var(--depth-1)");
    const slices = container.querySelectorAll(".msc-ring-slice");
    expect(slices.length).toBeGreaterThan(0);
    // Slices carry no inline stroke: the gap between them is CSS, in the card color.
    for (const s of slices) expect((s as SVGElement).style.stroke).toBe("");
    // Every in-slice figure names its kind so CSS can pick the fill's ink.
    const figures = container.querySelectorAll(".msc-ring-figure");
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(f.getAttribute("data-kind")).toBeTruthy();
    // Sky's wedge is split by what it is made of, each part in its own class.
    const parts = [...container.querySelectorAll(".msc-ring-sky-wedge")];
    expect(parts.map((w) => w.getAttribute("data-kind"))).toEqual(["cof", "sde"]);
    expect(parts[0]).toHaveClass("msc-ring-cof");
    expect(parts[1]).toHaveClass("msc-ring-sde");
  });
});
