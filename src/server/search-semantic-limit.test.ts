import { afterEach, describe, expect, it } from "bun:test";
import { config } from "./config.ts";
import {
  _resetSemanticBudget,
  newBucket,
  retryAfterSeconds,
  spendSemanticBudget,
  takeToken,
} from "./search-semantic-limit.ts";

const REAL_RPM = config.searchSemanticRpm;
afterEach(() => {
  config.searchSemanticRpm = REAL_RPM;
  _resetSemanticBudget();
});

describe("takeToken", () => {
  it("spends the burst, then refuses", () => {
    const b = newBucket(3, 0);
    expect(takeToken(b, 0, 3)).toBe(true);
    expect(takeToken(b, 0, 3)).toBe(true);
    expect(takeToken(b, 0, 3)).toBe(true);
    expect(takeToken(b, 0, 3)).toBe(false);
  });

  it("refills continuously rather than at a window boundary", () => {
    // 60/min is one per second, so a caller who ran dry waits a second, not
    // the rest of the minute — which is the whole reason this is a bucket.
    const b = newBucket(60, 0);
    for (let i = 0; i < 60; i++) expect(takeToken(b, 0, 60)).toBe(true);
    expect(takeToken(b, 0, 60)).toBe(false);
    expect(takeToken(b, 999, 60)).toBe(false);
    expect(takeToken(b, 1_000, 60)).toBe(true);
  });

  it("never banks more than the burst, however long it idles", () => {
    const b = newBucket(10, 0);
    expect(takeToken(b, 10 * 60_000, 10)).toBe(true); // ten minutes idle
    expect(b.tokens).toBeCloseTo(9, 6);
  });

  it("is not fooled by a clock that goes backwards", () => {
    const b = newBucket(10, 5_000);
    takeToken(b, 5_000, 10);
    const before = b.tokens;
    takeToken(b, 0, 10); // NTP step, or a test clock
    expect(b.tokens).toBeCloseTo(before - 1, 6);
  });
});

describe("retryAfterSeconds", () => {
  it("never says zero — that reads as 'retry immediately'", () => {
    const b = newBucket(60, 0);
    for (let i = 0; i < 60; i++) takeToken(b, 0, 60);
    expect(retryAfterSeconds(b, 60)).toBe(1);
  });

  it("scales with how slow the refill is", () => {
    const b = newBucket(6, 0);
    for (let i = 0; i < 6; i++) takeToken(b, 0, 6);
    expect(retryAfterSeconds(b, 6)).toBe(10); // 6/min = one per 10s
  });
});

describe("spendSemanticBudget", () => {
  it("reports exhaustion with a retry-after a caller can act on", () => {
    config.searchSemanticRpm = 2;
    expect(spendSemanticBudget(0)).toEqual({ ok: true });
    expect(spendSemanticBudget(0)).toEqual({ ok: true });
    const denied = spendSemanticBudget(0);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("is disabled by a rate of zero", () => {
    config.searchSemanticRpm = 0;
    for (let i = 0; i < 100; i++) expect(spendSemanticBudget(0)).toEqual({ ok: true });
  });
});
