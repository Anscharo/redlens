import { describe, expect, it } from "bun:test";
import { formatBootstrap, mulberry32, pairedBootstrap } from "./eval-bootstrap.ts";

const rows = (xs: [number, number][]) => xs.map(([a, b]) => ({ a, b }));

describe("pairedBootstrap", () => {
  it("identical arms: point 0 and interval [0, 0]", () => {
    const r = pairedBootstrap(rows([[1, 1], [0, 0], [1, 1], [0, 0]]), "a", "b", { rng: mulberry32(1) });
    expect(r.point).toBe(0);
    expect(r.lo).toBe(0);
    expect(r.hi).toBe(0);
    expect(r.pBetter).toBe(0);
    expect(r.n).toBe(4);
  });

  it("an arm that wins every row has pBetter 1", () => {
    const r = pairedBootstrap(rows([[1, 0], [1, 0], [1, 0]]), "a", "b", { rng: mulberry32(2), resamples: 500 });
    expect(r.point).toBe(100);
    expect(r.pBetter).toBe(1);
    expect(r.lo).toBe(100);
  });

  it("is deterministic under a fixed seed", () => {
    const data = rows([[1, 0], [0, 1], [1, 1], [1, 0], [0, 0], [1, 0]]);
    const x = pairedBootstrap(data, "a", "b", { rng: mulberry32(7), resamples: 300 });
    const y = pairedBootstrap(data, "a", "b", { rng: mulberry32(7), resamples: 300 });
    expect(x).toEqual(y);
    expect(x.lo).toBeLessThanOrEqual(x.point);
    expect(x.hi).toBeGreaterThanOrEqual(x.point);
  });
});

describe("formatBootstrap", () => {
  it("prints the leaf-attribution line format", () => {
    const s = formatBootstrap("a", "b", { point: 4.04, lo: -1, hi: 9.5, pBetter: 0.876, n: 10 });
    expect(s).toBe("a − b: 4.0 pts  95% CI [-1.0, 9.5]  P(a better)=0.88");
  });
});
