import { describe, it, expect } from "vitest";
import { formatTokens, ratioPct } from "./formatTokens";

describe("formatTokens", () => {
  it("renders under-1000 values as a rounded integer", () => {
    expect(formatTokens(842)).toBe("842");
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("renders thousands with one decimal and a 'k' suffix", () => {
    expect(formatTokens(18200)).toBe("18.2k");
    expect(formatTokens(1000)).toBe("1k");
  });

  it("strips a trailing '.0' from the k tier", () => {
    expect(formatTokens(18000)).toBe("18k");
  });

  it("renders millions with one decimal and an 'M' suffix", () => {
    expect(formatTokens(1200000)).toBe("1.2M");
  });

  it("strips a trailing '.0' from the M tier", () => {
    expect(formatTokens(2000000)).toBe("2M");
  });

  it("treats exactly 1e6 as the M tier, not k", () => {
    expect(formatTokens(1000000)).toBe("1M");
  });
});

describe("ratioPct", () => {
  it("computes the percent of the window used", () => {
    expect(ratioPct(18200, 128000)).toBeCloseTo(14.21875);
  });

  it("returns null when tokens is null (unknown last-turn size)", () => {
    expect(ratioPct(null, 128000)).toBeNull();
  });

  it("returns null when the window is null (unknown model window)", () => {
    expect(ratioPct(1000, null)).toBeNull();
  });

  it("returns null when the window is 0 (contract: 0 means unknown)", () => {
    expect(ratioPct(1000, 0)).toBeNull();
  });

  it("clamps above 100", () => {
    expect(ratioPct(200000, 128000)).toBe(100);
  });

  it("treats 0 tokens as a real (known) value, not unknown", () => {
    expect(ratioPct(0, 128000)).toBe(0);
  });
});
