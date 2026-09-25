import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildCoverageRequest,
  coverageVerdict,
  judgeAnswerCoverage,
  looksLikeRawToolOutput,
  MAX_PARTS,
  stripLinkTargets,
} from "./answer-coverage.ts";
import { config } from "../../config.ts";

const realFetch = globalThis.fetch;
const realKey = config.openrouterApiKey;
beforeEach(() => {
  config.openrouterApiKey = "test-key"; // stubbed fetch — askJev just refuses to build a request without one
  calls = 0;
  lastBody = null;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  config.openrouterApiKey = realKey;
});

let calls = 0;
let lastBody: any = null;
function answering(answers: Record<string, unknown>, status = 200) {
  globalThis.fetch = (async (_url: any, init: any) => {
    calls++;
    lastBody = JSON.parse(init.body);
    if (status !== 200) return new Response("nope", { status });
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 1300, output_tokens: 40, cost: 0.00008 }, id: "gen-dec-cov" }), { status: 200 });
  }) as typeof fetch;
}
const choice = (probabilities: Record<string, number>) => ({
  type: "choice",
  choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0],
  probabilities,
  confidence: 0.9,
});

// Distributions taken from the 2026-09-22 re-run (answer-coverage.ts's comments).
describe("coverageVerdict", () => {
  it("rules a narration that splits its mass between deflects and asks a non-answer", () => {
    expect(coverageVerdict({ deflects: 0.54, asks: 0.46, answers: 0, declines: 0 })).toBe("deflects");
    expect(coverageVerdict({ deflects: 0.44, asks: 0.32, answers: 0.18, declines: 0.06 })).toBe("deflects");
  });
  it("rules a clarifying question `asks` when asks carries the non-answer mass", () => {
    expect(coverageVerdict({ asks: 0.6, deflects: 0.3, answers: 0.1 })).toBe("asks");
  });
  it("stays quiet below the non-answer floor", () => {
    expect(coverageVerdict({ deflects: 0.3, asks: 0.15, answers: 0.55 })).toBe("answers");
  });
  it("only calls a reply `declines` when that is its main response", () => {
    expect(coverageVerdict({ declines: 0.79, answers: 0.21 })).toBe("answers");
    expect(coverageVerdict({ declines: 0.84, answers: 0.16 })).toBe("declines");
  });
});

describe("looksLikeRawToolOutput", () => {
  it("catches tool-call payloads", () => {
    expect(looksLikeRawToolOutput('{"id": ["A.2.2.5", "A.2.2.6"]}')).toBe(true);
    expect(looksLikeRawToolOutput('  {"query": "Pioneer Prime Keel", "k": 30}')).toBe(true);
    expect(looksLikeRawToolOutput('[{"name": "atlas_get"}]')).toBe(true);
    expect(looksLikeRawToolOutput('<\uFF5C\uFF5CDSML\uFF5C\uFF5Ctool_calls> <\uFF5C\uFF5CDSML\uFF5C\uFF5Cinvoke name="atlas_get">')).toBe(true);
  });
  it("leaves markdown answers alone, including one that opens with a link", () => {
    expect(looksLikeRawToolOutput("[Keel](/atlas/0b1c2d3e-0000-0000-0000-000000000000) is a Prime Agent.")).toBe(false);
    expect(looksLikeRawToolOutput('Here is the payload:\n```json\n{"a": 1}\n```')).toBe(false);
    expect(looksLikeRawToolOutput("The atlas defines three Pioneer Primes.")).toBe(false);
  });
});

describe("buildCoverageRequest", () => {
  it("sends no part Nouls for a single-part question", () => {
    const { questions, parts } = buildCoverageRequest("what is a scope?", "A scope is …");
    expect(parts).toEqual([]);
    expect(Object.keys(questions)).toEqual(["responds"]);
  });
  it("sends one Noul per part, naming the part", () => {
    const { questions, parts } = buildCoverageRequest("Which agents have paid distribution rewards out and how much?", "…");
    expect(parts).toEqual(["Which agents have paid distribution rewards out", "how much"]);
    expect(Object.keys(questions)).toEqual(["responds", "part_0", "part_1"]);
    expect(JSON.stringify(questions.part_1)).toContain('\\"how much\\"');
  });
  it("caps the part count", () => {
    const q = Array.from({ length: 12 }, (_, i) => `what is item ${i}?`).join(" ");
    const { questions, parts } = buildCoverageRequest(q, "…");
    expect(parts).toHaveLength(MAX_PARTS);
    expect(Object.keys(questions)).toHaveLength(MAX_PARTS + 1);
  });
  it("strips link targets from the answer, keeping the link text", () => {
    const { state } = buildCoverageRequest("q?", "See [Keel](/atlas/0b1c2d3e-0000-0000-0000-000000000000) and [x](http://a.b/(c)).");
    expect(state.answer).toBe("See [Keel] and [x].");
    expect(stripLinkTargets("[a](b)")).toBe("[a]");
  });
});

describe("judgeAnswerCoverage", () => {
  const Q = "Find all token transfers and give me a ledger of who sent what, how much and when.";
  it("names a dropped part on an answer, with usage for the checks row", async () => {
    answering({
      responds: choice({ answers: 0.97, declines: 0.02, deflects: 0.01, asks: 0 }),
      part_0: { type: "noul", noul: 0.96 },
      part_1: { type: "noul", noul: 0.98 },
      part_2: { type: "noul", noul: 0.19 },
    });
    const r = await judgeAnswerCoverage({ question: Q, answer: "| Sender | Amount |", model: "m" });
    expect(lastBody.model).toBe("m");
    expect(r?.verdict).toBe("answers");
    expect(r?.missingParts).toEqual(["when"]);
    expect(r?.parts.map((p) => p.p)).toEqual([0.96, 0.98, 0.19]);
    expect(r?.usage).toEqual({ input: 1300, output: 40 });
    expect(r?.generationId).toBe("gen-dec-cov");
    expect(r?.rawToolOutput).toBe(false);
  });
  it("does not list parts on a non-answer — the verdict already says it", async () => {
    answering({
      responds: choice({ deflects: 1, answers: 0, declines: 0, asks: 0 }),
      part_0: { type: "noul", noul: 0.05 },
      part_1: { type: "noul", noul: 0.05 },
      part_2: { type: "noul", noul: 0.05 },
    });
    const r = await judgeAnswerCoverage({ question: Q, answer: "Let me pull the ledger documents.", model: "m" });
    expect(r?.verdict).toBe("deflects");
    expect(r?.missingParts).toEqual([]);
  });
  it("ignores a malformed part Noul rather than reporting it missing", async () => {
    answering({ responds: choice({ answers: 1 }), part_0: { type: "choice", choice: "x" }, part_1: { type: "noul", noul: 0.9 }, part_2: { type: "noul", noul: 0.9 } });
    const r = await judgeAnswerCoverage({ question: Q, answer: "…", model: "m" });
    expect(r?.missingParts).toEqual([]);
    expect(r?.parts[0]?.p).toBeNull();
  });
  it("short-circuits raw tool output without a call", async () => {
    answering({ responds: choice({ answers: 1 }) });
    const r = await judgeAnswerCoverage({ question: "q?", answer: '{"id": ["A.2.2.5"]}', model: "m" });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ verdict: "deflects", rawToolOutput: true, probabilities: null });
  });
  it("fails open: a transport error or a wrong answer type is null, never a ruling", async () => {
    answering({}, 400);
    expect(await judgeAnswerCoverage({ question: "q?", answer: "a", model: "m" })).toBeNull();
    answering({ responds: { type: "noul", noul: 0.9 } });
    expect(await judgeAnswerCoverage({ question: "q?", answer: "a", model: "m" })).toBeNull();
  });
  it("honours its deadline across retries", async () => {
    answering({}, 503);
    const t0 = Date.now();
    expect(await judgeAnswerCoverage({ question: "q?", answer: "a", model: "m", deadlineMs: 600 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000); // un-deadlined retries take ~3.5s+
  });
});
