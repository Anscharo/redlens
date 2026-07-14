// Advisor unit tests: action parsing, timeout → null (annotate fallback).
import { test, expect } from "bun:test";
import type { JsonCall } from "./llm.ts";
import { parseRecovery, adviseRecovery } from "./advisor.ts";
import type { RoundTelemetry } from "./round-checks.ts";

const telemetry: RoundTelemetry = { rounds: 2, toolCalls: 3, emptyResults: 2, errorResults: 0, repeatedQueries: 1, notes: [] };

test("parseRecovery: valid actions parse, junk and unknown actions are null", () => {
  expect(parseRecovery('{"action":"rewrite","guidance":"drop claim 2"}')?.action).toBe("rewrite");
  expect(parseRecovery('```json\n{"action":"requery","guidance":"g","calls":[{"name":"atlas_query","args":{"search":"x"}}]}\n```')?.calls).toHaveLength(1);
  expect(parseRecovery('{"action":"retry-everything"}')).toBeNull();
  expect(parseRecovery("no json here")).toBeNull();
});

test("adviseRecovery returns the parsed recovery with usage", async () => {
  const call: JsonCall = async () => ({ text: '{"action":"decline","guidance":"be honest"}', usage: { input: 7, output: 3 }, generationId: "gen-a", latencyMs: 10 });
  const run = await adviseRecovery({ call, model: "m", question: "q", transcriptDigest: "d", verdict: null, telemetry });
  expect(run.recovery?.action).toBe("decline");
  expect(run.usage).toEqual({ input: 7, output: 3 });
});

test("adviseRecovery hard-caps latency: a hung call resolves null (annotate fallback)", async () => {
  const hang: JsonCall = () => new Promise(() => {});
  const run = await adviseRecovery({ call: hang, model: "m", question: "q", transcriptDigest: "d", verdict: null, telemetry, timeoutMs: 30 });
  expect(run.recovery).toBeNull();
});

test("adviseRecovery swallows transport errors as null", async () => {
  const boom: JsonCall = async () => {
    throw new Error("500");
  };
  const run = await adviseRecovery({ call: boom, model: "m", question: "q", transcriptDigest: "d", verdict: null, telemetry });
  expect(run.recovery).toBeNull();
});

test("deterministic check failures ride the advisor prompt when provided", async () => {
  let prompt = "";
  const call: JsonCall = async ({ messages }) => {
    prompt = messages.map((m) => m.content).join("\n");
    return { text: '{"action":"rewrite","guidance":"g"}', usage: { input: 1, output: 1 }, generationId: null, latencyMs: 1 };
  };
  await adviseRecovery({
    call, model: "m", question: "q", transcriptDigest: "d", verdict: null, telemetry,
    checkFailures: ["document number Q.99.42.7 does not exist in the atlas — remove it or replace it with the real number from the tool results"],
  });
  expect(prompt).toContain("Deterministic check failures");
  expect(prompt).toContain("Q.99.42.7");

  await adviseRecovery({ call, model: "m", question: "q", transcriptDigest: "d", verdict: null, telemetry });
  expect(prompt).not.toContain("Deterministic check failures");
});
