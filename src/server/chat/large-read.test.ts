import { expect, test } from "bun:test";
import { config } from "../config.ts";
import { chargeLargeRead, largeReadFor, previewCaps, resultBudget } from "./large-read.ts";

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
  chargeLargeRead(true, read, config.chatLargeReadMaxChars - 50_000);
  expect(resultBudget(true, read)).toBe(50_000);
  chargeLargeRead(false, read, 40_000); // an ordinary tool costs nothing here
  chargeLargeRead(true, read, 40_000);
  expect(resultBudget(true, read)).toBe(config.chatToolResultMaxChars);
});

test("preview page sizes stay small for MCP, small-window turns and a spent large read", () => {
  const small = { limit: 100, patchLines: 40, ids: 5 };
  expect(previewCaps(undefined)).toEqual(small);
  expect(previewCaps(null)).toEqual(small);
  const read = largeReadFor([LARGE])!;
  expect(previewCaps(read).ids).toBe(50);
  chargeLargeRead(true, read, config.chatLargeReadMaxChars);
  expect(previewCaps(read)).toEqual(small);
});
