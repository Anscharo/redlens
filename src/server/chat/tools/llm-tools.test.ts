// Tool-call adapter tests. Run under `bun test`.
import { expect, test } from "bun:test";
import { applyChatToolBudget } from "./llm-tools.ts";

test("applyChatToolBudget leaves small payloads unchanged", () => {
  const raw = JSON.stringify({ ok: true, results: ["small"] });
  const out = applyChatToolBudget(raw, 1_000);

  expect(out.content).toBe(raw);
  expect(out.truncated).toBe(false);
  expect(out.originalChars).toBe(raw.length);
  expect(out.returnedChars).toBe(raw.length);
});

test("applyChatToolBudget wraps oversized payloads with truncation metadata", () => {
  const raw = JSON.stringify({ results: Array.from({ length: 80 }, (_, i) => ({ i, text: "x".repeat(30) })) });
  const out = applyChatToolBudget(raw, 500);
  const parsed = JSON.parse(out.content) as Record<string, unknown>;

  expect(out.truncated).toBe(true);
  expect(out.originalChars).toBe(raw.length);
  expect(out.returnedChars).toBeLessThanOrEqual(500);
  expect(parsed.truncated).toBe(true);
  expect(parsed.original_chars).toBe(raw.length);
  expect(parsed.returned_chars).toBe(out.returnedChars);
  expect(typeof parsed.hint).toBe("string");
  expect(typeof parsed.preview_json).toBe("string");
});
