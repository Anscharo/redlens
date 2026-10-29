import { expect, test } from "bun:test";
import { config } from "../config.ts";
import { largeReadFor, previewCaps, reserveLargeRead, resultBudget, settleLargeRead } from "./large-read.ts";

const [LARGE] = config.chatLargeContextModels;

test("large reads need every model in the chain to have a large window", () => {
  expect(largeReadFor([LARGE])).toEqual({ left: config.chatLargeReadMaxChars, perResult: config.chatLargeResultMaxChars });
  expect(largeReadFor([LARGE, "google/gemma-4-31b-it"])).toBeNull();
  expect(largeReadFor([])).toBeNull();
});

test("only largeResult tools get the large budget", () => {
  const read = largeReadFor([LARGE]);
  expect(resultBudget(false, read)).toBe(config.chatToolResultMaxChars);
  expect(resultBudget(true, null)).toBe(config.chatToolResultMaxChars);
  expect(resultBudget(true, read)).toBe(config.chatLargeResultMaxChars);
});

test("the per-turn total shrinks and falls back to the ordinary budget once spent", () => {
  const read = largeReadFor([LARGE])!;
  for (const used of [config.chatLargeResultMaxChars, config.chatLargeReadMaxChars - config.chatLargeResultMaxChars - 50_000]) {
    settleLargeRead(read, reserveLargeRead(true, read), used);
  }
  expect(resultBudget(true, read)).toBe(50_000);
  const ordinary = reserveLargeRead(false, read); // an ordinary tool costs nothing here
  settleLargeRead(read, ordinary, 40_000);
  expect(read.left).toBe(50_000);
  const last = reserveLargeRead(true, read);
  settleLargeRead(read, last, 40_000);
  expect(resultBudget(true, read)).toBe(config.chatToolResultMaxChars);
});

test("calls of one round, granted before any returns, share the per-turn total", () => {
  const read = largeReadFor([LARGE])!;
  const grants = [1, 2, 3, 4].map(() => reserveLargeRead(true, read));
  const large = grants.filter((g) => g.chars > config.chatToolResultMaxChars);
  expect(large.reduce((n, g) => n + g.chars, 0)).toBeLessThanOrEqual(config.chatLargeReadMaxChars);
  expect(grants.reduce((n, g) => n + g.taken, 0)).toBe(config.chatLargeReadMaxChars);
  for (const g of grants) settleLargeRead(read, g, 10_000);
  expect(read.left).toBe(config.chatLargeReadMaxChars - grants.reduce((n, g) => n + Math.min(g.taken, 10_000), 0));
});

test("preview page sizes follow the granted budget: small for MCP and the ordinary budget", () => {
  const small = { limit: 100, patchLines: 40, ids: 5 };
  expect(previewCaps(undefined)).toEqual(small);
  expect(previewCaps(config.chatToolResultMaxChars)).toEqual(small);
  expect(previewCaps(config.chatLargeResultMaxChars).ids).toBe(50);
});
