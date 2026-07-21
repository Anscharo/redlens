// Orchestrator tests: fake ChatStream + fake JsonCall, real in-memory indexes.
// Covers event ordering (incl. the revision sequence), the escalation gate,
// the exactly-one-recovery-cycle cap, and internal-field sanitization.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { loadIndexes } from "./indexes.ts";
import { config } from "./config.ts";
import type { ChatStream } from "./chat-loop.ts";
import type { JsonCall } from "./llm.ts";
import { runVerifiedChat, sanitizeDone, type HarnessEvent, type HarnessDone } from "./chat-orchestrator.ts";

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
const ix = loadIndexes();

const textChunk = (text: string): Chunk =>
  ({ id: "gen-abc", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) as unknown as Chunk;
const toolChunk = (name: string, args: string): Chunk =>
  ({
    id: "gen-abc",
    choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: args } }] }, finish_reason: null },
    ],
  }) as unknown as Chunk;
const finishChunk = (reason: string): Chunk =>
  ({ id: "gen-abc", choices: [{ index: 0, delta: {}, finish_reason: reason }] }) as unknown as Chunk;
const usageChunk = (pin: number, pout: number): Chunk =>
  ({ id: "gen-abc", choices: [], usage: { prompt_tokens: pin, completion_tokens: pout, total_tokens: pin + pout } }) as unknown as Chunk;

async function* emit(chunks: Chunk[]): AsyncIterable<Chunk> {
  for (const c of chunks) yield c;
}
// Replays rounds across ALL runChat invocations (initial + revision share it).
function fakeStream(rounds: Chunk[][]): ChatStream {
  let i = 0;
  return () => emit(rounds[Math.min(i++, rounds.length - 1)] ?? []);
}
// Replays scripted JSON responses; records each call's model.
function fakeJson(texts: string[], calls: { model: string }[] = []): JsonCall {
  let i = 0;
  return async ({ model }) => {
    calls.push({ model });
    return { text: texts[Math.min(i++, texts.length - 1)] ?? "", usage: { input: 10, output: 5 }, generationId: `gen-j${i}`, latencyMs: 5 };
  };
}

async function collect(gen: AsyncGenerator<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
const kinds = (events: HarnessEvent[]) => events.map((e) => (e.type === "status" ? `status:${e.stage}` : e.type));
const lastDone = (events: HarnessEvent[]) => events.at(-1) as HarnessDone;

const userMsg: Msg = { role: "user", content: "hi" };
const PASS = '{"claims":[{"claim":"x","status":"supported"}],"invented_facts":[],"ruling_issued":false,"confidence":0.9,"feedback":""}';
const FAIL = '{"claims":[{"claim":"x","status":"contradicted"}],"invented_facts":[],"ruling_issued":false,"confidence":0.3,"feedback":"claim x contradicted"}';

function withModels(verifier: string, advisor: string, fn: () => Promise<void>): Promise<void> {
  const pv = config.chatVerifierModel;
  const pa = config.chatAdvisorModel;
  config.chatVerifierModel = verifier;
  config.chatAdvisorModel = advisor;
  return fn().finally(() => {
    config.chatVerifierModel = pv;
    config.chatAdvisorModel = pa;
  });
}

test("no model slots: pass-through + status ticker; done carries checksMeta; sanitizeDone strips internals", () =>
  withModels("", "", async () => {
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop"), usageChunk(100, 10)],
    ];
    const events = await collect(runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream(rounds), question: "hi", maxIterations: 3 }));

    expect(kinds(events)).toEqual(["status:querying", "tool_call", "tool_result", "token", "done"]);
    const done = lastDone(events);
    expect(done.content).toBe("Answer.");
    expect(done.checksMeta.map((c) => c.kind)).toEqual(["round_checks"]);
    expect(done.transcript.length).toBeGreaterThan(0);

    const wire = sanitizeDone(done);
    expect("transcript" in wire).toBe(false);
    expect("checksMeta" in wire).toBe(false);
    expect(wire.content).toBe("Answer.");
  }));

test("deterministic-only mode stays quiet on clean answers, flags invalid citations", () =>
  withModels("", "", async () => {
    const bad = "See [X](/atlas/00000000-dead-beef-0000-000000000000).";
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(bad), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const verify = events.find((e) => e.type === "verify_result");
    expect(verify && verify.type === "verify_result" && verify.overall).toBe("fail");
    expect(verify && verify.type === "verify_result" && verify.invalidCitations).toEqual(["00000000-dead-beef-0000-000000000000"]);
    expect(verify && verify.type === "verify_result" && verify.action).toBe("annotate");
  }));

test("fabricated citation uuid is repaired in code when the title identifies a real doc", () =>
  withModels("", "", async () => {
    // Unique-title doc → the repair pass swaps the invented uuid for the real
    // one; nothing is stripped, so the deterministic-only turn stays quiet.
    const counts = new Map<string, number>();
    for (const d of ix.docMap.values()) counts.set(d.title, (counts.get(d.title) ?? 0) + 1);
    const doc = [...ix.docMap.values()].find((d) => d.title.length > 12 && counts.get(d.title) === 1)!;
    const bad = `Per [${doc.title}](/atlas/12345678-1234-4321-8765-1234567890ab).`;
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(bad), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    expect(events.some((e) => e.type === "verify_result")).toBe(false);
    expect(lastDone(events).content).toBe(`Per [${doc.title}](/atlas/${doc.id}).`);
  }));

test("deterministic-only mode flags fabricated doc numbers as hard failures", () =>
  withModels("", "", async () => {
    const bad = "That rule is defined in Q.99.42.7 of the atlas.";
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(bad), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const verify = events.find((e) => e.type === "verify_result");
    expect(verify && verify.type === "verify_result" && verify.overall).toBe("fail");
    expect(verify && verify.type === "verify_result" && verify.invalidDocNos).toEqual(["Q.99.42.7"]);
  }));

test("verifier pass: checking status, verify_result pass, no advisor call", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Answer."), finishChunk("stop")]]),
        jsonCall: fakeJson([PASS], jsonCalls),
      }),
    );
    expect(kinds(events)).toEqual(["token", "status:checking", "verify_result", "done"]);
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    expect(jsonCalls).toEqual([{ model: "strong/verifier" }]); // advisor never ran
    expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify"]);
  }));

test("verifier fail → advisor rewrite → revision replaces answer → re-verify once", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    const rounds = [
      [textChunk("Bad answer."), finishChunk("stop"), usageChunk(100, 10)],
      [textChunk("Fixed answer."), finishChunk("stop"), usageChunk(50, 5)],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeJson([FAIL, '{"action":"rewrite","guidance":"remove claim x"}', PASS], jsonCalls),
      }),
    );

    // The plan's revision sequence, in order.
    expect(kinds(events)).toEqual([
      "token", "status:checking", "verify_result",
      "status:advising", "status:revising", "clear",
      "token", "status:checking", "verify_result", "done",
    ]);
    const [first, second] = events.filter((e) => e.type === "verify_result");
    expect(first.type === "verify_result" && first.overall).toBe("fail");
    expect(first.type === "verify_result" && first.action).toBeNull();
    expect(second.type === "verify_result" && second.overall).toBe("pass");
    expect(second.type === "verify_result" && second.action).toBe("revised");

    const done = lastDone(events);
    expect(done.content).toBe("Fixed answer.");
    expect(done.usage).toEqual({ input: 150, output: 15 }); // both passes summed
    expect(done.checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify", "advisor_recovery", "verify_recheck"]);
    // Exactly one recovery cycle: verifier + advisor + recheck, nothing more.
    expect(jsonCalls.map((c) => c.model)).toEqual(["strong/verifier", "chat/advisor", "strong/verifier"]);
    // The recovery row preserves the original answer for the audit trail.
    const advisorRow = done.checksMeta.find((c) => c.kind === "advisor_recovery")!;
    expect((advisorRow.verdict as { originalAnswer: string }).originalAnswer).toBe("Bad answer.");
  }));

test("advisor failure (garbage JSON) falls back to annotate — original answer stands", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Bad answer."), finishChunk("stop")]]),
        jsonCall: fakeJson([FAIL, "sorry, no json"]),
      }),
    );
    expect(events.filter((e) => e.type === "verify_result")).toHaveLength(1);
    expect(events.some((e) => e.type === "clear")).toBe(false);
    const done = lastDone(events);
    expect(done.content).toBe("Bad answer.");
    const advisorRow = done.checksMeta.find((c) => c.kind === "advisor_recovery")!;
    expect(advisorRow.action).toBe("annotate");
  }));

test("verifier pass suppresses escalation even when the loop was exhausted", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    // max=2: one tool round consumes iter 0, the answer is the forced final.
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], question: "hi", maxIterations: 2, stream: fakeStream(rounds), jsonCall: fakeJson([PASS], jsonCalls) }),
    );
    expect(jsonCalls.map((c) => c.model)).toEqual(["strong/verifier"]);
    expect(events.some((e) => e.type === "status" && e.stage === "advising")).toBe(false);
  }));
