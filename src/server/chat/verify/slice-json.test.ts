// Tolerant JSON parsing for the harness's judge calls.
import { test, expect } from "bun:test";
import { closeTruncatedJson, parseJsonish } from "./slice-json.ts";

test("closeTruncatedJson ignores braces inside quoted strings", () => {
  expect(closeTruncatedJson('{"a":"a { brace"')).toBe('{"a":"a { brace"}');
  expect(closeTruncatedJson('{"a":"unterminated')).toBe('{"a":"unterminated"}');
});

test("parseJsonish tolerates trailing commas and prose after the JSON", () => {
  expect(parseJsonish('{"claims":[],}')).toEqual({ claims: [] });
  expect(parseJsonish('```json\n{"ok":true}\n```\nHope this helps!')).toEqual({ ok: true });
});

test("parseJsonish still returns null when there is no object at all", () => {
  expect(parseJsonish("I could not complete this audit.")).toBeNull();
});

test("parseJsonish salvages a generation truncated mid-array", () => {
  const truncated = '{"contradictions":[{"answer_span":"A","evidence_span":"B","why":"C"}],"not_found":["D';
  const parsed = parseJsonish(truncated);
  expect(parsed).not.toBeNull();
  expect((parsed as { contradictions: unknown[] }).contradictions).toHaveLength(1);
});
