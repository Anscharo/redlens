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

  it("puts the three figures in the aria-label and the sub-categories in the tooltip", () => {
    const { layout, primes } = ringPrimes([flow()], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$10.00M" />,
    );
    expect(
      screen.getByRole("link", {
        name: "Spark, Jul 2026: $10.00M to Sky, $2.00M supply kept, $1.50M demand-side. Open settlement page.",
      }),
    ).toBeInTheDocument();
    const title = container.querySelector("title")!.textContent!;
    expect(title).toContain("of which cost of funds $9.90M");
    expect(title).toContain("Sky Direct Exposure $100k");
    expect(title).toContain("agent rate $1.40M");
    expect(title).toContain("distribution rewards $100k");
  });

  it("styles a negative flow with the loss class", () => {
    const { layout, primes } = ringPrimes([flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })], "2026-07");
    const { container } = render(
      <MscRing layout={layout} primes={primes} month="2026-07" centerFigure="$497" />,
    );
    expect(container.querySelector(".msc-ring-loss")).toBeInTheDocument();
    expect(container.querySelector(".msc-ring-kept")).not.toBeInTheDocument();
  });
});
