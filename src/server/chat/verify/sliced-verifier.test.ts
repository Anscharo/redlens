// Sliced-verifier unit tests: merge semantics (no false green), per-slice
// model routing, worklist targeting, span demotion, usage aggregation.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { config } from "../../config.ts";
import type { JsonCall } from "../llm.ts";
import { buildIndexes } from "../../retrieval/indexes.ts";
import type { AtlasNode } from "../../../types.ts";
import type { CheckReport } from "./verify-checks.ts";
import { mergeSlices, runSlicedVerifier, sliceModels } from "./sliced-verifier.ts";
import type { SliceResult } from "./verifier-slices.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Empty synthetic index: none of these tests exercise the absence contract
// (see absence.test.ts / the dedicated cases below for that) — merge/span
// semantics only need SOME Indexes to satisfy mergeSlices' signature.
const ix = buildIndexes([], [], [], {});

// Non-empty index for the absence-contract post-processing tests below: one
// known parameter (Keel's USDS Mint Maximum) to refute against.
function node(p: Partial<AtlasNode> & { id: string; doc_no: string; title: string; content: string }): AtlasNode {
  return { type: "Core", depth: 3, parentId: null, order: 0, addressRefs: [], ...p };
}
const keelOwner = node({ id: "keel-owner", doc_no: "T.1", title: "Keel", type: "Instance", depth: 2, content: "" });
const keelParam = node({
  id: "keel-param",
  doc_no: "T.1.1",
  title: "USDS Mint Maximum",
  parentId: "keel-owner",
  content: ["The maximum amount of USDS that can be minted is specified in the document herein.", "", "- `maxAmount`: 10,000 USDS"].join("\n"),
});
const paramIx = buildIndexes([keelOwner, keelParam], [], [], {});

const sr = (partial: Partial<SliceResult> & { slice: SliceResult["slice"] }): SliceResult => ({
  claims: [], rulingIssued: false, notes: "", parsed: true, latencyMs: 5, usage: { input: 10, output: 5 }, ...partial,
});

test("mergeSlices: nothing parsed → null (unverified)", () => {
  expect(mergeSlices([sr({ slice: "claims", parsed: false }), sr({ slice: "figures", parsed: false })], ix, [])).toBeNull();
});

test("mergeSlices: claims backbone missing + clean figures → null, not a false green", () => {
  const v = mergeSlices(
    [sr({ slice: "claims", parsed: false }), sr({ slice: "figures", claims: [{ claim: "8.75%", status: "supported", span: "8.75%" }] })],
    ix,
    [],
  );
  expect(v).toBeNull();
});

test("mergeSlices: backbone missing but severity survives (contradiction kept)", () => {
  const v = mergeSlices(
    [sr({ slice: "claims", parsed: false }), sr({ slice: "sets", claims: [{ claim: "the list omits Grove", status: "contradicted", span: "Grove" }] })],
    ix,
    [],
  );
  expect(v?.claims.map((c) => c.status)).toEqual(["contradicted"]);
});

test("mergeSlices: overreach ruling survives a missing backbone", () => {
  const v = mergeSlices([sr({ slice: "claims", parsed: false }), sr({ slice: "overreach", rulingIssued: true })], ix, []);
  expect(v?.ruling_issued).toBe(true);
});

test("mergeSlices: span-invalid demotions are noted and reach feedback", () => {
  const v = mergeSlices(
    [
      sr({
        slice: "claims",
        claims: [{ claim: "x", status: "unsupported", span: "not in evidence", spanValid: false, spanScore: 0.2 }],
        notes: "one shaky claim",
      }),
    ],
    ix,
    [],
  );
  expect(v?.claims[0].note).toContain("span-invalid(0.20)");
  expect(v?.feedback).toContain("claims: one shaky claim");
  expect(v?.feedback).toContain("demoted to unsupported");
});

// ---------------------------------------------------------------------------
// Absence contract post-processing (verify/absence.ts, wired inline in
// mergeSlices): a claim marked absence+supported no longer gets a free pass.
// ---------------------------------------------------------------------------
test("mergeSlices: a refuted absence claim is downgraded to contradicted, driving overall to fail", () => {
  const v = mergeSlices(
    [sr({ slice: "claims", claims: [{ claim: "the atlas does not specify a USDS mint maximum for Keel", status: "supported", span: "", absence: true }] })],
    paramIx,
    [],
  );
  expect(v?.claims[0].status).toBe("contradicted");
  expect(v?.claims[0].note).toContain("absence-refuted: maxamount (keel) = 10,000 USDS (T.1.1)");
  expect(v?.feedback).toContain("1 absence claim refuted by the parameter table");
  expect(v?.feedback).toContain("the answer must state the real value");
});

test("mergeSlices: an unverified absence claim is downgraded to unsupported (warn/escalation territory)", () => {
  const v = mergeSlices(
    [sr({ slice: "claims", claims: [{ claim: "the atlas does not specify a governance token vesting cliff", status: "supported", span: "", absence: true }] })],
    paramIx,
    [],
  );
  expect(v?.claims[0].status).toBe("unsupported");
  expect(v?.claims[0].note).toContain("absence-unverified");
  expect(v?.feedback).toContain("1 absence claim unverified — requery");
});

test("mergeSlices: a grounded absence claim stays supported, with the signal noted", () => {
  const v = mergeSlices(
    [sr({ slice: "claims", claims: [{ claim: "the atlas does not specify a governance token vesting cliff", status: "supported", span: "", absence: true }] })],
    paramIx,
    [{ args: '{"q":"governance token vesting cliff"}', content: '{"count":0,"results":[]}' }],
  );
  expect(v?.claims[0].status).toBe("supported");
  expect(v?.claims[0].note).toContain("absence-grounded(empty-result)");
  expect(v?.feedback).not.toContain("refuted");
  expect(v?.feedback).not.toContain("unverified — requery");
});

test("mergeSlices: an empty result for a different subject does NOT ground the absence claim", () => {
  const v = mergeSlices(
    [sr({ slice: "claims", claims: [{ claim: "the atlas does not specify a governance token vesting cliff", status: "supported", span: "", absence: true }] })],
    paramIx,
    [{ args: '{"q":"grove multisig signers"}', content: '{"count":0,"results":[]}' }],
  );
  expect(v?.claims[0].status).toBe("unsupported");
  expect(v?.claims[0].note).toContain("absence-unverified");
  expect(v?.feedback).toContain("unverified — requery");
});

test("mergeSlices: non-absence claims and already-flagged absence claims are never audited", () => {
  const v = mergeSlices(
    [
      sr({
        slice: "claims",
        claims: [
          // Non-absence supported claim: untouched even though its text could
          // otherwise refute-match — the contract only applies to absence claims.
          { claim: "Keel's USDS mint maximum exists", status: "supported", span: "10,000 USDS", absence: false },
          // Already-contradicted/unsupported absence claims: the slice already
          // flagged trouble — not re-audited or re-noted.
          { claim: "the atlas does not specify a USDS mint maximum for Keel", status: "contradicted", span: "", absence: true },
        ],
      }),
    ],
    paramIx,
    [],
  );
  expect(v?.claims[0].note).not.toContain("absence-refuted");
  expect(v?.claims[1].status).toBe("contradicted");
  expect(v?.claims[1].note).not.toContain("absence-refuted");
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
    ix,
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
