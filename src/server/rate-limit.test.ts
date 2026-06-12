// Pure rate-limit window-math tests. The token SUM is DB-backed (integration);
// the bucket boundary logic is pure + deterministic. Run under `bun test`.
import { test, expect } from "bun:test";
import { bucketBounds } from "./rate-limit.ts";

const TWO_H = 120 * 60 * 1000;

test("2h bucket aligns to the wall clock (epoch-aligned)", () => {
  const now = Date.UTC(2026, 5, 1, 9, 30, 0); // 09:30 UTC
  const { startMs, resetsAtMs } = bucketBounds(now, TWO_H);
  expect(new Date(startMs).getUTCHours()).toBe(8); // bucket 08:00–10:00
  expect(new Date(startMs).getUTCMinutes()).toBe(0);
  expect(new Date(resetsAtMs).getUTCHours()).toBe(10);
  expect(resetsAtMs - startMs).toBe(TWO_H);
});

test("now sits inside [start, reset)", () => {
  const now = Date.UTC(2026, 5, 1, 9, 30, 0);
  const { startMs, resetsAtMs } = bucketBounds(now, TWO_H);
  expect(startMs).toBeLessThanOrEqual(now);
  expect(resetsAtMs).toBeGreaterThan(now);
});

test("on a boundary, the bucket starts exactly at now", () => {
  const now = Date.UTC(2026, 5, 1, 8, 0, 0);
  expect(bucketBounds(now, TWO_H).startMs).toBe(now);
});

test("an instant just before a boundary still maps to the current bucket", () => {
  const now = Date.UTC(2026, 5, 1, 9, 59, 59);
  const { startMs, resetsAtMs } = bucketBounds(now, TWO_H);
  expect(new Date(startMs).getUTCHours()).toBe(8);
  expect(new Date(resetsAtMs).getUTCHours()).toBe(10);
});
