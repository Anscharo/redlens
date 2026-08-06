import { describe, it, expect } from "vitest";
import { refreshAllowed, REFRESH_INTERVAL_MS } from "./balances";

describe("refreshAllowed", () => {
  const now = 1_000_000_000_000;
  it("allows when never checked", () => {
    expect(refreshAllowed(null, now)).toBe(true);
  });
  it("blocks within the interval", () => {
    expect(refreshAllowed(now - 60_000, now)).toBe(false); // 1 min ago
  });
  it("allows exactly at the interval boundary and beyond", () => {
    expect(refreshAllowed(now - REFRESH_INTERVAL_MS, now)).toBe(true);
    expect(refreshAllowed(now - REFRESH_INTERVAL_MS - 1, now)).toBe(true);
  });
});
