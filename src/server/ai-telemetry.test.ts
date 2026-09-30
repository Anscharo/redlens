import { beforeEach, expect, mock, test } from "bun:test";

const captured: any[] = [];
let enabled = true;
mock.module("./posthog-node.ts", () => ({
  getPosthog: () => (enabled ? { capture: (e: any) => captured.push(e) } : null),
}));
const { captureAiCall } = await import("./ai-telemetry.ts");

beforeEach(() => {
  captured.length = 0;
  enabled = true;
});

test("generation event carries surface, tokens, cost, environment and trace", () => {
  captureAiCall({
    kind: "generation", surface: "jev:smalltalk", jevTask: "smalltalk", model: "m", inputTokens: 10, outputTokens: 2,
    costUsd: 0.01, latencyMs: 1500, distinctId: "conv", traceId: "t1",
  });
  expect(captured).toHaveLength(1);
  const e = captured[0];
  expect(e.event).toBe("$ai_generation");
  expect(e.distinctId).toBe("conv");
  expect(e.properties).toMatchObject({
    $ai_provider: "openrouter", $ai_model: "m", $ai_input_tokens: 10, $ai_output_tokens: 2,
    $ai_total_cost_usd: 0.01, $ai_latency: 1.5, $ai_trace_id: "t1", chat_surface: "jev:smalltalk", jev_task: "smalltalk",
  });
  expect(typeof e.properties.environment).toBe("string");
  expect(e.properties.$process_person_profile).toBeUndefined();
});

test("embedding event without a conversation is anonymous and has no output tokens", () => {
  captureAiCall({ kind: "embedding", surface: "embed-query", model: "e", inputTokens: 5, latencyMs: 200 });
  const e = captured[0];
  expect(e.event).toBe("$ai_embedding");
  expect(e.distinctId).toBe("server");
  expect(e.properties.$process_person_profile).toBe(false);
  expect("$ai_output_tokens" in e.properties).toBe(false);
  expect("$ai_total_cost_usd" in e.properties).toBe(false);
});

test("is a silent no-op without PostHog", () => {
  enabled = false;
  captureAiCall({ kind: "generation", surface: "x", model: "m", inputTokens: 1, latencyMs: 1 });
  expect(captured).toHaveLength(0);
});
