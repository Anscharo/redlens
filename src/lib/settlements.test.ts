import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("./verify", () => ({
  fetchJson: (...a: unknown[]) => fetchJson(...a),
}));

import {
  loadSettlements,
  resetSettlementsCache,
  reportsForPrime,
  formatMonth,
  formatUsd,
  revenueGap,
  EMPTY_SETTLEMENTS,
  type SettlementReport,
  type SettlementsBundle,
} from "./settlements";

function report(over: Partial<SettlementReport> = {}): SettlementReport {
  return {
    prime: "spark",
    month: "2026-07",
    settleVersion: "0.4.0",
    generatedAt: null,
    period: { start: "2026-07-01", end: "2026-07-31", nDays: 31 },
    headline: {
      primeAgentRevenue: 100,
      skyRevenue: 60,
      profitToGrove: 40,
      cof: 40,
      sdeRevenue: 20,
    },
    venues: [
      {
        id: "S1",
        label: "SparkLend USDS",
        chain: "ethereum",
        synthetic: false,
        revenueToPrime: 90,
        cofAlloc: 50,
        profitToSky: 50,
        profitToGrove: 40,
      },
    ],
    ...over,
  };
}

describe("formatMonth / formatUsd", () => {
  it("renders Jul 2026 from 2026-07", () => {
    expect(formatMonth("2026-07")).toBe("Jul 2026");
  });

  it("passes through a malformed stamp", () => {
    expect(formatMonth("nope")).toBe("nope");
  });

  it("formats compact millions and thousands, with a minus sign", () => {
    expect(formatUsd(1_560_000, true)).toBe("$1.56M");
    expect(formatUsd(6110, true)).toBe("$6k");
    expect(formatUsd(-42, false)).toBe("−$42");
  });
});

describe("reportsForPrime / revenueGap", () => {
  const bundle: SettlementsBundle = {
    source: { repo: "soterlabs/settlement-reports" },
    reports: [
      report({ month: "2026-06" }),
      report({ prime: "grove", month: "2026-07" }),
      report({ month: "2026-07" }),
    ],
  };

  it("returns that prime's reports oldest-first", () => {
    expect(reportsForPrime(bundle, "spark").map((r) => r.month)).toEqual(["2026-06", "2026-07"]);
    expect(reportsForPrime(bundle, "keel")).toEqual([]);
  });

  it("is the absolute gap between Σ revenueToPrime and the headline", () => {
    expect(revenueGap(report())).toBe(10);
    expect(revenueGap(report({ headline: { ...report().headline, primeAgentRevenue: 90 } }))).toBe(0);
  });
});

describe("loadSettlements", () => {
  beforeEach(() => {
    resetSettlementsCache();
    fetchJson.mockReset();
  });
  afterEach(() => resetSettlementsCache());

  it("returns the fetched bundle and memoises it", async () => {
    const bundle: SettlementsBundle = { source: {}, reports: [report()] };
    fetchJson.mockResolvedValue(bundle);
    await expect(loadSettlements()).resolves.toBe(bundle);
    await expect(loadSettlements()).resolves.toBe(bundle);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toMatch(/settlements\.json$/);
  });

  it("returns EMPTY_SETTLEMENTS when the artifact is missing, and retries next call", async () => {
    fetchJson.mockRejectedValueOnce(new Error("settlements.json: 404"));
    await expect(loadSettlements()).resolves.toBe(EMPTY_SETTLEMENTS);
    fetchJson.mockResolvedValueOnce({ source: {}, reports: [report()] });
    await expect(loadSettlements()).resolves.toEqual({ source: {}, reports: [report()] });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});
