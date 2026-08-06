// Sliced-verifier unit tests: merge semantics (no false green), per-slice
// model routing, worklist targeting, span demotion, usage aggregation.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { config } from "../../config.ts";
import type { JsonCall } from "../llm.ts";
import type { CheckReport } from "./verify-checks.ts";
import { mergeSlices, runSlicedVerifier, sliceModels } from "./sliced-verifier.ts";
import type { SliceResult } from "./verifier-slices.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const sr = (partial: Partial<SliceResult> & { slice: SliceResult["slice"] }): SliceResult => ({
  claims: [], rulingIssued: false, notes: "", parsed: true, latencyMs: 5, usage: { input: 10, output: 5 }, ...partial,
});

test("mergeSlices: nothing parsed → null (unverified)", () => {
  expect(mergeSlices([sr({ slice: "claims", parsed: false }), sr({ slice: "figures", parsed: false })])).toBeNull();
});

test("mergeSlices: claims backbone missing + clean figures → null, not a false green", () => {
  const v = mergeSlices([
    sr({ slice: "claims", parsed: false }),
    sr({ slice: "figures", claims: [{ claim: "8.75%", status: "supported", span: "8.75%" }] }),
  ]);
  expect(v).toBeNull();
});

test("mergeSlices: backbone missing but severity survives (contradiction kept)", () => {
  const v = mergeSlices([
    sr({ slice: "claims", parsed: false }),
    sr({ slice: "sets", claims: [{ claim: "the list omits Grove", status: "contradicted", span: "Grove" }] }),
  ]);
  expect(v?.claims.map((c) => c.status)).toEqual(["contradicted"]);
});

test("mergeSlices: overreach ruling survives a missing backbone", () => {
  const v = mergeSlices([sr({ slice: "claims", parsed: false }), sr({ slice: "overreach", rulingIssued: true })]);
  expect(v?.ruling_issued).toBe(true);
});

test("mergeSlices: span-invalid demotions are noted and reach feedback", () => {
  const v = mergeSlices([
    sr({
      slice: "claims",
      claims: [{ claim: "x", status: "unsupported", span: "not in evidence", spanValid: false, spanScore: 0.2 }],
      notes: "one shaky claim",
    }),
  ]);
  expect(v?.claims[0].note).toContain("span-invalid(0.20)");
  expect(v?.feedback).toContain("claims: one shaky claim");
  expect(v?.feedback).toContain("demoted to unsupported");
});

test("sliceModels: overrides parse with whitespace, unnamed slices fall back", () => {
  const pm = config.chatVerifierModel;
  const ps = config.chatVerifierSliceModels;
  config.chatVerifierModel = "fallback/model";
  config.chatVerifierSliceModels = "claims=a/one, figures = b/two";
  try {
    expect(sliceModels()).toEqual({ claims: "a/one", figures: "b/two", sets: "fallback/model", overreach: "fallback/model" });
  } finally {
    config.chatVerifierModel = pm;
    config.chatVerifierSliceModels = ps;
  }
});

test("runSlicedVerifier: routes per-slice models, targets worklist at figures, sums usage, validates spans", async () => {
  const calls: { model: string; prompt: string }[] = [];
  const respond: Record<string, string> = {
    "m/claims": '{"claims":[{"claim":"ratio is 8.75%","status":"supported","span":"capital ratio is 8.75%","absence":false},{"claim":"made up","status":"supported","span":"the moon is made of cheese","absence":false}],"notes":"ok"}',
    "m/figures": '{"claims":[{"claim":"8.75%","status":"supported","span":"capital ratio is 8.75%"}],"notes":""}',
    "m/sets": '{"claims":[],"notes":""}',
    "m/over": '{"ruling_issued":false,"claims":[],"notes":""}',
  };
  const call: JsonCall = async ({ model, messages }) => {
    calls.push({ model, prompt: (messages as Msg[]).map((m) => m.content as string).join("\n") });
    return { text: respond[model] ?? "{}", usage: { input: 10, output: 5 }, generationId: "g", latencyMs: 3 };
  };
  const run = await runSlicedVerifier({
    call,
    models: { claims: "m/claims", figures: "m/figures", sets: "m/sets", overreach: "m/over" },
    question: "q",
    answer: "The capital ratio is 8.75%.",
    evidence: [{ label: "[E1]", tool: "atlas_get", args: "{}", content: "The capital ratio is 8.75% under the risk framework." }],
    checks: { untracedNumbers: ["8.75%"] } as unknown as CheckReport,
  });

  expect(calls.map((c) => c.model).sort()).toEqual(["m/claims", "m/figures", "m/over", "m/sets"]);
  const promptOf = (m: string) => calls.find((c) => c.model === m)!.prompt;
  expect(promptOf("m/figures")).toContain("decide derived vs invented");
  expect(promptOf("m/claims")).not.toContain("decide derived vs invented");
  expect(promptOf("m/over")).not.toContain("Evidence retrieved this turn"); // overreach reads stance, not evidence

  expect(run.usage).toEqual({ input: 40, output: 20 });
  expect(run.latencyMs).toBe(3);
  const byClaim = Object.fromEntries(run.verdict!.claims.map((c) => [c.claim, c.status]));
  expect(byClaim["ratio is 8.75%"]).toBe("supported"); // span found verbatim in evidence
  expect(byClaim["made up"]).toBe("unsupported"); // span validation demoted it
  expect(run.verdict!.ruling_issued).toBe(false);
});
