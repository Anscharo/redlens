// Orchestrator tests: fake ChatStream + fake JsonCall, real in-memory indexes.
// Covers event ordering, the deterministic + model-audit verdict (always
// annotate-only), and internal-field sanitization.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { loadIndexes } from "../retrieval/indexes.ts";
import { config } from "../config.ts";
import type { ChatStream } from "./chat-loop.ts";
import type { JsonCall } from "./llm.ts";
import { runVerifiedChat, sanitizeDone, describeCall, type HarnessEvent, type HarnessDone } from "./chat-orchestrator.ts";
import { SLICES } from "./verify/sliced-verifier.ts";
import type { SliceName } from "./verify/verifier-slices.ts";
import { atlasDescribe } from "./tools/tools.ts";
import { findParamsMentioned } from "./verify/param-checks.ts";

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;
type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
const ix = loadIndexes();

const textChunk = (text: string): Chunk =>
  ({ id: "gen-abc", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) as unknown as Chunk;
const reasoningChunk = (text: string): Chunk =>
  ({ id: "gen-abc", choices: [{ index: 0, delta: { reasoning: text }, finish_reason: null }] }) as unknown as Chunk;
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
function fakeStream(rounds: Chunk[][]): ChatStream {
  let i = 0;
  return () => emit(rounds[Math.min(i++, rounds.length - 1)] ?? []);
}
async function collect(gen: AsyncGenerator<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
const kinds = (events: HarnessEvent[]) => events.map((e) => (e.type === "status" ? `status:${e.stage}` : e.type));
const lastDone = (events: HarnessEvent[]) => events.at(-1) as HarnessDone;

const userMsg: Msg = { role: "user", content: "hi" };

// The orchestrator's only audit path is the sliced one (verify/sliced-verifier.ts):
// two concurrent auditors — `refute` (evidence-contradiction) and `overreach`
// (stance) — over the same evidence, plus a CONDITIONAL `confirm` call that
// only fires when either produced a candidate. A fixture therefore has to
// look like a SliceResult (`{contradictions:[{answer_span,evidence_span,why}],
// not_found,notes}` for refute, `{ruling_issued,notes}` for overreach) — and a
// contradiction is only kept if BOTH spans are re-validated in code
// (refute.ts's validateContradictions), and only AGREED if the confirm call
// says so.
//
// [E0] schema evidence (chat-orchestrator.ts's schemaEvidence) is ALWAYS
// present regardless of tool calls, so a literal drawn from it gives every
// FAIL fixture a real, always-available evidence_span without needing a live
// tool round. Guarded below so a reword of tools.ts's atlasDescribe() output
// fails loudly instead of silently discarding these fixtures.
const REAL_SPAN = "Use atlas_entities to search/list entities by name, type, or subtype.";
test("REAL_SPAN literal used by refute FAIL fixtures is still present in atlas_describe's [E0] schema evidence", () => {
  expect(JSON.stringify(atlasDescribe(ix))).toContain(REAL_SPAN);
});

test("describeCall reads the standardized `query` arg for both atlas_search and atlas_query", () => {
  expect(describeCall("atlas_search", { query: "keel maxAmount", k: 10 })).toBe('Searching the atlas for “keel maxAmount”…');
  expect(describeCall("atlas_query", { query: "spark rewards" })).toBe('Searching the atlas for “spark rewards”…');
  // No `query` present (e.g. an entity/target_type-only atlas_query call) falls
  // back to the generic "Consulting <tool>…" line rather than crashing.
  expect(describeCall("atlas_query", { entity: "spark" })).toBe("Consulting atlas_query…");
});

test("describeCall falls back to the deprecated `q` alias — an MCP-era caller can still send it", () => {
  expect(describeCall("atlas_query", { q: "spark rewards" })).toBe('Searching the atlas for “spark rewards”…');
  expect(describeCall("atlas_entities", { q: "keel" })).toBe('Searching the atlas for “keel”…');
  // `query` still wins when both are present.
  expect(describeCall("atlas_query", { query: "a", q: "b" })).toBe('Searching the atlas for “a”…');
});

// Both parseRefute and the overreach parser tolerate a bare "{}" — no
// contradictions/not_found for refute, ruling_issued defaults false for
// overreach — so one literal works as the universal "nothing to report" reply.
const SLICE_EMPTY = "{}";
// A refute fixture asserting ONE contradiction against the answer text
// itself: `answer_span` is the literal streamed answer (spanOverlap 1 against
// it), `evidence_span` is REAL_SPAN (always present via [E0]) so the code
// backstop always validates it.
const sliceFail = (answerText: string) =>
  JSON.stringify({ contradictions: [{ answer_span: answerText, evidence_span: REAL_SPAN, why: "contradicts the schema" }], not_found: [], notes: "" });
const CONFIRM_AGREE = '{"agree":[1],"notes":""}';

// Identifies which of the three possible concurrent/conditional calls a
// JsonCall invocation is, by its system prompt — content dispatch, not call
// order. Includes "confirm" even though it isn't in SLICES (it's driven
// separately by sliced-verifier.ts once refute/overreach produce a candidate).
const SLICE_SIGNATURE: Record<SliceName, string> = {
  refute: "CONTRADICTS", overreach: "ADJUDICATE", confirm: "first auditor",
};
function identifySlice(messages: Msg[]): SliceName | "unmatched" {
  const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
  return (Object.keys(SLICE_SIGNATURE) as SliceName[]).find((s) => sys.includes(SLICE_SIGNATURE[s])) ?? "unmatched";
}
// `scripts[slice]` is consumed in order, once per call to that slice (its own
// counter). Unscripted slices get a neutral empty verdict.
function fakeSlicedJson(scripts: Partial<Record<SliceName, string[]>>, calls: { model: string }[] = []): JsonCall {
  const seen: Partial<Record<SliceName, number>> = {};
  return async ({ model, messages }) => {
    calls.push({ model });
    const msgs = messages as Msg[];
    const slice = identifySlice(msgs);
    // An unmatched call means a prompt reword broke SLICE_SIGNATURE's match —
    // a bug in the fixture, not a valid case — so throw instead of silently
    // returning a neutral verdict, so the mismatch names itself instead of
    // surfacing as a confusing verdict downstream.
    if (slice === "unmatched") {
      const sys = typeof msgs[0]?.content === "string" ? msgs[0].content : "";
      throw new Error(`fakeSlicedJson: call didn't match any slice signature — system prompt started: ${sys.slice(0, 120)}`);
    }
    const arr = scripts[slice] ?? [SLICE_EMPTY];
    const idx = seen[slice] ?? 0;
    seen[slice] = idx + 1;
    return { text: arr[Math.min(idx, arr.length - 1)] ?? SLICE_EMPTY, usage: { input: 10, output: 5 }, generationId: `gen-j${idx}`, latencyMs: 5 };
  };
}
// A clean slice round's model list, in SLICES order (Promise.all over the two
// concurrent auditors). No confirm call unless a candidate exists.
const sliceRound = (model: string) => Array(SLICES.length).fill(model);

// refuteMode defaults to "answer" — CHAT_REFUTE_MODE="paragraph" is the
// runtime default, but every test in this file below was written against the
// pre-2026-09 whole-answer sequencing (one refute call over the finished
// answer, via the fakeSlicedJson/sliceRound fixtures). Pinning "answer" here
// makes this file the answer-mode regression suite; paragraph-mode behavior
// gets its own tests further down, opting in with the third argument.
function withModels(verifier: string, fn: () => Promise<void>, refuteMode: "answer" | "paragraph" = "answer"): Promise<void> {
  const pv = config.chatVerifierModel;
  const pj = config.chatSmalltalkJudgeModel;
  const pr = config.chatRefuteMode;
  config.chatVerifierModel = verifier;
  // The judge slot defaults ON in config — zero it here so every test
  // exercises the audit path it was written for; bypass tests opt back in
  // with the nested withJudge wrapper below.
  config.chatSmalltalkJudgeModel = "";
  config.chatRefuteMode = refuteMode;
  return fn().finally(() => {
    config.chatVerifierModel = pv;
    config.chatSmalltalkJudgeModel = pj;
    config.chatRefuteMode = pr;
  });
}

test("no model slots: pass-through + status ticker; done carries checksMeta; sanitizeDone strips internals", () =>
  withModels("", async () => {
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop"), usageChunk(100, 10)],
    ];
    const events = await collect(runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream(rounds), question: "hi", maxIterations: 3 }));

    expect(kinds(events)).toEqual([
      "status:querying", "tool_call", "tool_result", "status:synthesizing", "token",
      "paragraph_check", "status:comparing", "answer_final", "done",
    ]);
    const done = lastDone(events);
    expect(done.content).toBe("Answer.");
    expect(done.checksMeta.map((c) => c.kind)).toEqual(["round_checks"]);
    expect(done.transcript.length).toBeGreaterThan(0);

    const wire = sanitizeDone(done);
    expect("transcript" in wire).toBe(false);
    expect("checksMeta" in wire).toBe(false);
    expect(wire.content).toBe("Answer.");
  }));

// ── Small-talk bypass ──────────────────────────────────────────────────────
// Config-gates the judge slot the same way withModels gates the verifier.
function withJudge(model: string, fn: () => Promise<void>): Promise<void> {
  const prev = config.chatSmalltalkJudgeModel;
  config.chatSmalltalkJudgeModel = model;
  return fn().finally(() => {
    config.chatSmalltalkJudgeModel = prev;
  });
}
// Wraps a JsonCall so the judge's distinctive prompt gets a scripted ruling
// and every other call falls through to the inner fake — content dispatch,
// same principle as identifySlice.
function withJudgeRuling(inner: JsonCall, ruling: string, judgeCalls: { model: string }[] = []): JsonCall {
  return async (params) => {
    const sys = typeof params.messages[0]?.content === "string" ? params.messages[0].content : "";
    if (sys.includes('{"smalltalk"')) {
      judgeCalls.push({ model: params.model });
      return { text: ruling, usage: { input: 5, output: 2 }, generationId: "gen-judge", latencyMs: 3 };
    }
    return inner(params);
  };
}
const GREETING = "Hello! How can I help you with the Sky Atlas?";

test("small-talk bypass: zero tools + uncheckable answer + judge says smalltalk → no audit", () =>
  withModels("strong/verifier", () =>
    withJudge("fast/judge", async () => {
      const sliceCalls: { model: string }[] = [];
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hello", maxIterations: 3,
          stream: fakeStream([[textChunk(GREETING), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({}, sliceCalls), '{"smalltalk": true}', judgeCalls),
        }),
      );
      // Straight to done: no comparing/checking ticker, no verify chip, no
      // slice calls — only the one judge call, recorded in checksMeta.
      expect(kinds(events)).toEqual(["status:synthesizing", "token", "paragraph_check", "done"]);
      expect(judgeCalls).toEqual([{ model: "fast/judge" }]);
      expect(sliceCalls).toEqual([]);
      const done = lastDone(events);
      expect(done.content).toBe(GREETING);
      expect(done.checksMeta.map((c) => c.kind)).toEqual(["smalltalk_judge"]);
    })));

test("judge rules the question expects facts → full audit runs despite an uncheckable answer", () =>
  withModels("strong/verifier", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "is the fee governance-controlled?", maxIterations: 3,
          stream: fakeStream([[textChunk("Yes, that is governed."), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({}), '{"smalltalk": false}', judgeCalls),
        }),
      );
      expect(judgeCalls.length).toBe(1);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
      expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["smalltalk_judge", "round_checks", "verify"]);
    })));

test("a zero-tool answer with groundable content is never bypassed — even a smalltalk ruling can't skip the audit", () =>
  withModels("strong/verifier", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([[textChunk("A.1.6 covers that."), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({}), '{"smalltalk": true}', judgeCalls),
        }),
      );
      // The judge FIRED (concurrently, on the uncheckable first message) but
      // its favorable ruling is not consulted: the answer cited without
      // tools — the hallucination case — so the audit runs regardless. The
      // call still lands in checksMeta so its tokens count toward the
      // rate-limit window.
      expect(judgeCalls.length).toBe(1);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
      const meta = lastDone(events).checksMeta;
      expect(meta.map((c) => c.kind).slice(0, 3)).toEqual(["smalltalk_judge", "round_checks", "verify"]);
      expect(meta[0].inputTokens).toBe(5);
      expect(meta[0].outputTokens).toBe(2);
    })));

test("the judge never fires on a groundable QUESTION — 'what is A.1.6?' needs no model to be ruled factual", () =>
  withModels("strong/verifier", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "what is A.1.6?", maxIterations: 3,
          stream: fakeStream([[textChunk(GREETING), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({}), '{"smalltalk": true}', judgeCalls),
        }),
      );
      expect(judgeCalls).toEqual([]);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
    })));

test("the judge never fires past the first user message — later turns always audit", () =>
  withModels("strong/verifier", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const history: Msg[] = [
        { role: "user", content: "what governs the fee?" },
        { role: "assistant", content: "The fee is governed by A.1.6." },
        { role: "user", content: "thanks!" },
      ];
      const events = await collect(
        runVerifiedChat({
          ix, messages: history, question: "thanks!", maxIterations: 3,
          stream: fakeStream([[textChunk("You're welcome!"), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({}), '{"smalltalk": true}', judgeCalls),
        }),
      );
      expect(judgeCalls).toEqual([]);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
    })));

test("no judge model configured → bypass disabled outright, greetings get the full audit", () =>
  withModels("strong/verifier", async () => {
    const sliceCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hello", maxIterations: 3,
        stream: fakeStream([[textChunk(GREETING), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({}, sliceCalls),
      }),
    );
    expect(sliceCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
    expect(events.some((e) => e.type === "verify_result")).toBe(true);
  }));

test("a stripped (unrepairable) link is not a failure: the reader never saw it, and the checks judge what shipped", () =>
  withModels("", async () => {
    // Observed 2026-09-10: a red badge read "cites a document that does not
    // exist: a2e7af9" under an answer that contained no such link — the gate
    // had already de-linkified it. The strip is recorded on the round_checks
    // row; it must not become a verdict.
    const bad = "See [X](/atlas/00000000-dead-beef-0000-000000000000).";
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(bad), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const done = events.find((e) => e.type === "done") as HarnessDone;
    expect(done.content).not.toContain("00000000-dead-beef");
    expect(events.some((e) => e.type === "verify_result")).toBe(false); // deterministic-only + nothing failed ⇒ quiet
    const round = done.checksMeta.find((c) => c.kind === "round_checks");
    expect((round?.verdict as { repair: { stripped: unknown[] } }).repair.stripped).toHaveLength(1);
  }));

test("reference-style citations are normalized to canonical inline form before repair and checks", () =>
  withModels("", async () => {
    // The definition block is dropped, the reference link inlines, and the
    // measured bare-bracket defect is unbracketed — so the checking layer sees
    // one real citation and the user never sees literal brackets.
    const uuid = ix.docMap.keys().next().value as string;
    const answer = [`[the-doc]: /atlas/${uuid}`, "", "The rule is [5%][the-doc] and a range of [20 percentage points] applies."].join("\n");
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(answer), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const done = lastDone(events);
    expect(done.content).toBe(`The rule is [5%](/atlas/${uuid}) and a range of 20 percentage points applies.`);
    expect(events.some((e) => e.type === "verify_result")).toBe(false);
    const row = done.checksMeta[0].verdict as { refs?: { definitions: number; undefinedLabels: string[]; unusedLabels: string[] } };
    expect(row.refs).toEqual({ definitions: 1, undefinedLabels: [], unusedLabels: [] });
  }));

test("a leaked entity slug never reaches done.content, and is recorded in the checks row", () =>
  withModels("", async () => {
    // Same shape as the reported turn: an entity row in hand, no document read,
    // so the handle is deleted (nothing retrieved this turn grounds a link).
    const ent = [...ix.entityBySlug.values()].find((e) => e.defining_doc_id && ix.docMap.has(e.defining_doc_id))!;
    const doc = ix.docMap.get(ent.defining_doc_id!)!;
    const answer = `- **${ent.name}**: (Slug: ${ent.slug})`;
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(answer), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const done = lastDone(events);
    expect(done.content).toBe(`- **${ent.name}**`);
    const row = done.checksMeta[0].verdict as { identifiers?: { linkified: string[]; removed: string[] } };
    expect(row.identifiers).toEqual({ linkified: [], removed: [ent.slug] });

    // With the entity's defining doc in this turn's evidence, the same leak
    // becomes a real citation instead.
    const toolMsg: Msg = { role: "tool", tool_call_id: "call_1", content: JSON.stringify({ defining_doc_id: doc.id }) };
    const grounded = await collect(
      runVerifiedChat({ ix, messages: [userMsg, toolMsg], stream: fakeStream([[textChunk(answer), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    expect(lastDone(grounded).content).toBe(`- **[${ent.name}](/atlas/${doc.id})**`);
  }));

test("fabricated citation uuid is repaired in code when the title identifies a real doc", () =>
  withModels("", async () => {
    // Unique-title doc → the repair pass swaps the invented uuid for the real
    // one; nothing is stripped, so the deterministic-only turn stays quiet.
    const counts = new Map<string, number>();
    for (const d of ix.docMap.values()) counts.set(d.title, (counts.get(d.title) ?? 0) + 1);
    const doc = [...ix.docMap.values()].find((d) => d.title.length > 12 && counts.get(d.title) === 1)!;
    const bad = `Per [${doc.title}](/atlas/12345678-1234-4321-8765-1234567890ab).`;
    // Split mid-uuid so the streaming gate has to hold across token boundaries.
    const chunks = [bad.slice(0, bad.indexOf("/atlas/") + 12), bad.slice(bad.indexOf("/atlas/") + 12)];
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[...chunks.map(textChunk), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    expect(events.some((e) => e.type === "verify_result")).toBe(false);
    expect(lastDone(events).content).toBe(`Per [${doc.title}](/atlas/${doc.id}).`);
    // The streaming gate already repaired the link in the token stream — the
    // client never saw the fabricated uuid, and the stream matches done.
    const streamed = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("");
    expect(streamed).toBe(lastDone(events).content);
  }));

test("verification disabled: done.content still carries the gate's citation repair", () =>
  withModels("", async () => {
    // With CHAT_VERIFY_CHECKS=0 the post-answer audit is skipped, but the
    // streaming gate still repaired the link in the token stream. done.content
    // (authoritative client-side) must match that stream, or the client swaps
    // the repaired link back to the fabricated one at completion.
    const prev = config.chatVerifyChecks;
    config.chatVerifyChecks = false;
    try {
      const counts = new Map<string, number>();
      for (const d of ix.docMap.values()) counts.set(d.title, (counts.get(d.title) ?? 0) + 1);
      const doc = [...ix.docMap.values()].find((d) => d.title.length > 12 && counts.get(d.title) === 1)!;
      const bad = `Per [${doc.title}](/atlas/12345678-1234-4321-8765-1234567890ab).`;
      const chunks = [bad.slice(0, bad.indexOf("/atlas/") + 12), bad.slice(bad.indexOf("/atlas/") + 12)];
      const events = await collect(
        runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[...chunks.map(textChunk), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
      );
      const streamed = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("");
      expect(lastDone(events).content).toBe(`Per [${doc.title}](/atlas/${doc.id}).`);
      expect(streamed).toBe(lastDone(events).content);
    } finally {
      config.chatVerifyChecks = prev;
    }
  }));

test("deterministic-only mode flags fabricated doc numbers as hard failures", () =>
  withModels("", async () => {
    const bad = "That rule is defined in Q.99.42.7 of the atlas.";
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(bad), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const verify = events.find((e) => e.type === "verify_result");
    expect(verify && verify.type === "verify_result" && verify.overall).toBe("fail");
    expect(verify && verify.type === "verify_result" && verify.invalidDocNos).toEqual(["Q.99.42.7"]);
  }));

test("verifier pass: checking status counts real sources, verify_result pass", () =>
  withModels("strong/verifier", async () => {
    const jsonCalls: { model: string }[] = [];
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({}, jsonCalls),
      }),
    );
    expect(kinds(events)).toEqual([
      "status:querying", "tool_call", "tool_result", "status:synthesizing", "token",
      "paragraph_check", "status:comparing", "answer_final", "status:checking", "verify_result", "done",
    ]);
    // One tool result → one evidence entry: singular, and never "0 sources".
    const checking = events.find((e) => e.type === "status" && e.stage === "checking")!;
    expect(checking.type === "status" && checking.detail).toBe("Cross-checking the answer against 1 source…");
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    expect(verify.type === "verify_result" && verify.contradictions).toEqual([]);
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier")); // no confirm call — no candidates
    expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify"]);
    const verifyMeta = lastDone(events).checksMeta.find((m) => m.kind === "verify")!;
    expect((verifyMeta.verdict as { confirm: unknown }).confirm).toBeNull();
  }));

test("comparing status fires on a grounded turn even with no verifier model", () =>
  withModels("", async () => {
    // No verifier model configured — deterministic checks alone still
    // enter the verification block, so "comparing" fires even without a
    // "checking" status right behind it.
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], question: "hi", maxIterations: 3, stream: fakeStream(rounds) }),
    );
    expect(kinds(events)).toEqual([
      "status:querying", "tool_call", "tool_result", "status:synthesizing", "token",
      "paragraph_check", "status:comparing", "answer_final", "done",
    ]);
  }));

test("ungrounded turn: verification stages are suppressed, the audit still runs", () =>
  withModels("strong/verifier", async () => {
    // Nothing retrieved this turn and no earlier turns to fall back on, so
    // there is no basis to name — "against 0 sources" must never be announced.
    // The audit itself is unchanged (a no-retrieval answer is the most
    // hallucination-prone case); only the ticker goes quiet.
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Answer."), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({}),
      }),
    );
    expect(kinds(events)).toEqual(["status:synthesizing", "token", "paragraph_check", "answer_final", "verify_result", "done"]);
    expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify"]);
  }));

test("no tools but earlier turns: the stages name the conversation as the basis", () =>
  withModels("strong/verifier", async () => {
    const history: Msg[] = [
      { role: "user", content: "what is the stability scope?" },
      { role: "assistant", content: "The Stability Scope covers…" },
      { role: "user", content: "summarize that" },
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: history, question: "summarize that", maxIterations: 3,
        stream: fakeStream([[textChunk("In short: it covers…"), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({}),
      }),
    );
    const details = events.filter((e) => e.type === "status").map((e) => (e.type === "status" ? e.detail : ""));
    expect(details).toEqual([
      "Writing an answer from the evidence…",
      "Comparing the draft against the conversation so far…",
      "Cross-checking the answer against earlier turns of this conversation…",
    ]);
  }));

test("comparing status is absent when the answer is empty or checks are off", () =>
  withModels("", async () => {
    // Both turns are grounded (a tool round runs), so an absent "comparing"
    // here is attributable to the empty answer / checks being off, not to the
    // ungrounded suppression the tests above cover.
    const toolRound = [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")];
    const emptyEvents = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([toolRound, [finishChunk("stop")]]),
      }),
    );
    expect(emptyEvents.some((e) => e.type === "status" && e.stage === "comparing")).toBe(false);
    expect(emptyEvents.some((e) => e.type === "answer_final")).toBe(false);

    const prev = config.chatVerifyChecks;
    config.chatVerifyChecks = false;
    try {
      const checksOffEvents = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([toolRound, [textChunk("Answer."), finishChunk("stop")]]),
        }),
      );
      expect(checksOffEvents.some((e) => e.type === "status" && e.stage === "comparing")).toBe(false);
      // The config-off early exit repairs done.content for the wire but never
      // reaches the "round_checks" block answer_final trails — the client
      // falls back to revealing on `done` here.
      expect(checksOffEvents.some((e) => e.type === "answer_final")).toBe(false);
    } finally {
      config.chatVerifyChecks = prev;
    }
  }));

// A sentence the [E-const] matcher (param-checks.ts's findParamsMentioned)
// resolves to a real param row, DERIVED from the live index rather than named.
// This test used to hardcode Keel's "USDS Mint Maximum" doc as verified
// real-corpus ground truth; an upstream regrouping deleted that doc and the
// test failed on atlas content, not on orchestrator behaviour. Any single doc
// can vanish the same way, so pick whatever the served atlas currently offers:
// a row whose OWNING DOC'S TITLE is what a model would actually write (the
// `byTitle` path — terse kv names like "maxamount" never appear in prose), and
// whose sentence matches few enough rows that its own name survives
// chat-orchestrator.ts's CONST_EVIDENCE_CAP truncation.
const CONST_EVIDENCE_CAP = 40;
function titleMatchableParam(): { text: string; name: string } {
  for (const row of ix.params.rows) {
    const title = ix.docMap.get(row.uuid)?.title;
    if (!title || !row.owner) continue; // owner tokens are what pass findParamsMentioned's owner gate
    const text = `${row.owner}'s ${title} is ${row.value}.`;
    const hits = findParamsMentioned(text, ix);
    if (hits.length > CONST_EVIDENCE_CAP) continue;
    if (hits.some((h) => h.row.uuid === row.uuid && h.byTitle)) return { text, name: row.name };
  }
  throw new Error("no title-matchable param row in the served atlas — [E-const] has nothing to key on");
}

test("[E-const] standing evidence: included when the answer mentions a known parameter, absent otherwise", () =>
  withModels("strong/verifier", async () => {
    // Keyed by slice (via identifySlice), not push order — "overreach" gets no
    // evidence block at all (SLICE_NEEDS_EVIDENCE.overreach === false), so
    // asserting on "whichever call landed first" would be one SLICES-order
    // change away from checking the wrong slice's prompt.
    const capturedBySlice = new Map<SliceName | "unmatched", string>();
    const jsonCall: JsonCall = async ({ messages }) => {
      const msgs = messages as Msg[];
      capturedBySlice.set(identifySlice(msgs), msgs.map((m) => m.content as string).join("\n"));
      return { text: SLICE_EMPTY, usage: { input: 10, output: 5 }, generationId: "g", latencyMs: 5 };
    };
    const { text: withParam, name } = titleMatchableParam();
    await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk(withParam), finishChunk("stop")]]),
        jsonCall,
      }),
    );
    const refutePrompt = capturedBySlice.get("refute")!;
    expect(refutePrompt).toContain("[E-const]");
    expect(refutePrompt).toContain("atlas_param_table");
    expect(refutePrompt).toContain(name);
    // No candidate was ever produced (SLICE_EMPTY), so confirm never fired.
    expect(capturedBySlice.has("confirm")).toBe(false);

    capturedBySlice.clear();
    const withoutParam = "The weather report has nothing to do with atlas governance parameters.";
    await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk(withoutParam), finishChunk("stop")]]),
        jsonCall,
      }),
    );
    expect(capturedBySlice.get("refute")).not.toContain("[E-const]");
  }));

test("two concurrent slice audits (clean) merge into one verdict + pass badge, confirm never called", () =>
  withModels("strong/verifier", async () => {
    const jsonCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([
          [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
          [textChunk("Answer."), finishChunk("stop")],
        ]),
        jsonCall: fakeSlicedJson({}, jsonCalls),
      }),
    );
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    const meta = lastDone(events).checksMeta.find((m) => m.kind === "verify")!;
    expect(meta.model).toBe("sliced(strong/verifier)");
  }));

test("an overreach ruling alone (no contradiction) yields a warn badge, not fail", () =>
  withModels("strong/verifier", async () => {
    const jsonCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Ruling: the applicant is hereby eligible."), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({ overreach: ['{"ruling_issued":true,"notes":"adjudicated"}'] }, jsonCalls),
      }),
    );
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("warn");
    expect(verify.type === "verify_result" && verify.rulingIssued).toBe(true);
    // A ruling has no candidates of its own — confirm still never runs.
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
  }));

test("verifier fail on a grounded turn: fail badge, annotate-only — the answer is never rewritten", () =>
  withModels("strong/verifier", async () => {
    const jsonCalls: { model: string }[] = [];
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Bad answer."), finishChunk("stop"), usageChunk(100, 10)],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({ refute: [sliceFail("Bad answer.")], confirm: [CONFIRM_AGREE] }, jsonCalls),
      }),
    );

    // No revision machinery of any kind — one audit, one confirm, one badge, done.
    expect(kinds(events)).toEqual([
      "status:querying", "tool_call", "tool_result", "status:synthesizing", "token",
      "paragraph_check", "status:comparing", "answer_final", "status:checking", "verify_result", "done",
    ]);
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("fail");
    expect(verify.type === "verify_result" && verify.contradictions).toHaveLength(1);
    expect(verify.type === "verify_result" && verify.contradictions[0]).toMatchObject({ answer: "Bad answer.", evidence: REAL_SPAN });
    expect(events.some((e) => e.type === "clear")).toBe(false);

    const done = lastDone(events);
    expect(done.content).toBe("Bad answer.");
    expect(done.usage).toEqual({ input: 100, output: 10 });
    expect(done.checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify"]);
    // Two slices, then one conditional confirm call, once a candidate exists.
    expect(jsonCalls.map((c) => c.model)).toEqual([...sliceRound("strong/verifier"), "strong/verifier"]);
    const verifyMeta = done.checksMeta.find((m) => m.kind === "verify")!;
    const verdict = verifyMeta.verdict as { confirm: { ran: boolean; model: string | null; candidates: number; agreed: number; parsed: boolean } | null };
    expect(verdict.confirm).toEqual({ ran: true, model: "strong/verifier", candidates: 1, agreed: 1, parsed: true });
  }));

test("an unagreed contradiction candidate never reaches the wire and the badge stays pass", () =>
  withModels("strong/verifier", async () => {
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Some answer."), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({ refute: [sliceFail("Some answer.")], confirm: ['{"agree":[],"notes":""}'] }),
      }),
    );
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    expect(verify.type === "verify_result" && verify.contradictions).toEqual([]);
    expect(verify.type === "verify_result" && "candidates" in verify).toBe(false);
    // The unagreed candidate still lives in the persisted verdict for calibration.
    const verifyMeta = lastDone(events).checksMeta.find((m) => m.kind === "verify")!;
    const verdict = verifyMeta.verdict as { contradictions: { agreed: boolean }[] };
    expect(verdict.contradictions).toHaveLength(1);
    expect(verdict.contradictions[0].agreed).toBe(false);
  }));

test("a confirm gate OUTAGE (unparseable) with a candidate on the table reads unverified, not pass — no contradictions on the wire", () =>
  withModels("strong/verifier", async () => {
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Some answer."), finishChunk("stop")]]),
        // The confirm call itself fails to parse — NOT the same as it
        // considering the candidate and disagreeing (that case is the
        // previous test, and correctly stays "pass").
        jsonCall: fakeSlicedJson({ refute: [sliceFail("Some answer.")], confirm: ["not json"] }),
      }),
    );
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("unverified");
    expect(verify.type === "verify_result" && verify.contradictions).toEqual([]);
    const verifyMeta = lastDone(events).checksMeta.find((m) => m.kind === "verify")!;
    const verdict = verifyMeta.verdict as { confirm: { ran: boolean; model: string | null; parsed: boolean; candidates: number; agreed: number } | null };
    expect(verdict.confirm).toEqual({ ran: true, model: "strong/verifier", candidates: 1, agreed: 0, parsed: false });
  }));

test("reasoning deltas pass through runVerifiedChat unmodified and never leak into the answer text", () =>
  withModels("strong/verifier", async () => {
    const rounds = [
      [reasoningChunk("thinking about the answer"), textChunk("Answer."), finishChunk("stop"), usageChunk(100, 10)],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({}),
      }),
    );
    const reasoningTexts = events.filter((e) => e.type === "reasoning").map((e) => (e as { text: string }).text);
    expect(reasoningTexts).toEqual(["thinking about the answer"]);
    const done = lastDone(events);
    expect(done.content).toBe("Answer.");
    // Reasoning never leaks into the answer text.
    expect(done.content).not.toContain("thinking");
  }));

// ── Unified delivery: synthesizing per burst, answer_final after repair ────
test("synthesizing announces once per generation burst — a tool round re-announces it", () =>
  withModels("", async () => {
    const rounds = [
      [textChunk("Thinking out loud."), toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], question: "hi", maxIterations: 3, stream: fakeStream(rounds) }),
    );
    const synthIdx = events.map((e, i) => (e.type === "status" && e.stage === "synthesizing" ? i : -1)).filter((i) => i >= 0);
    expect(synthIdx).toHaveLength(2); // burst 1 (pre-tool prose), burst 2 (the real answer)
    const toolCallIdx = events.findIndex((e) => e.type === "tool_call");
    expect(synthIdx[0]).toBeLessThan(toolCallIdx); // announced before the tool round it precedes
    expect(synthIdx[1]).toBeGreaterThan(toolCallIdx); // tool_call reset the burst, so it re-announces
  }));

test("answer_final fires right after deterministic repair, before the checking status, carrying the repaired content", () =>
  withModels("strong/verifier", async () => {
    // Same fixture as "fabricated citation uuid is repaired in code…": a
    // real doc's title with an invented uuid, repaired by code before the
    // audit ever runs — answer_final must carry the REPAIRED content.
    const counts = new Map<string, number>();
    for (const d of ix.docMap.values()) counts.set(d.title, (counts.get(d.title) ?? 0) + 1);
    const doc = [...ix.docMap.values()].find((d) => d.title.length > 12 && counts.get(d.title) === 1)!;
    const bad = `Per [${doc.title}](/atlas/12345678-1234-4321-8765-1234567890ab).`;
    const rounds = [[toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")], [textChunk(bad), finishChunk("stop")]];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({}),
      }),
    );
    const repaired = `Per [${doc.title}](/atlas/${doc.id}).`;
    const answerFinal = events.find((e) => e.type === "answer_final");
    expect(answerFinal?.type === "answer_final" && answerFinal.content).toBe(repaired);
    const answerFinalIdx = events.findIndex((e) => e.type === "answer_final");
    const checkingIdx = events.findIndex((e) => e.type === "status" && e.stage === "checking");
    expect(checkingIdx).toBeGreaterThan(-1);
    expect(answerFinalIdx).toBeLessThan(checkingIdx);
    expect(lastDone(events).content).toBe(repaired);
  }));

// ── Incremental (per-paragraph) deterministic checks ───────────────────────
test("a streamed two-paragraph answer yields two paragraph_check events — the tail flushed before answer_final", () =>
  withModels("", async () => {
    // The first paragraph closes (and checks) the moment the closing token
    // arrives; the second has no trailing blank line, so it is the trailing
    // paragraph flushed at generation end, inside the streaming loop, well
    // before the repair/checks block that produces answer_final.
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("The Stability Scope covers protocol rates.\n\nThe Accessibility Scope covers frontends."), finishChunk("stop")]]),
      }),
    );
    const checkEvents = events.filter((e) => e.type === "paragraph_check");
    expect(checkEvents).toHaveLength(2);
    expect(checkEvents.map((e) => (e.type === "paragraph_check" ? e.index : -1))).toEqual([0, 1]);
    expect(checkEvents.map((e) => (e.type === "paragraph_check" ? e.text : ""))).toEqual([
      "The Stability Scope covers protocol rates.", "The Accessibility Scope covers frontends.",
    ]);
    const lastCheckIdx = events.map((e) => e.type === "paragraph_check").lastIndexOf(true);
    const answerFinalIdx = events.findIndex((e) => e.type === "answer_final");
    expect(lastCheckIdx).toBeLessThan(answerFinalIdx);
  }));

test("a tool_call between bursts resets the paragraph index to 0", () =>
  withModels("", async () => {
    const rounds = [
      [textChunk("Pre-tool paragraph.\n\n"), toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Post-tool paragraph.\n\n"), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], question: "hi", maxIterations: 3, stream: fakeStream(rounds) }),
    );
    const checkEvents = events.filter((e) => e.type === "paragraph_check");
    expect(checkEvents.map((e) => (e.type === "paragraph_check" ? e.index : -1))).toEqual([0, 0]);
    expect(checkEvents.map((e) => (e.type === "paragraph_check" ? e.text : ""))).toEqual([
      "Pre-tool paragraph.", "Post-tool paragraph.",
    ]);
  }));

test("a paragraph with a fabricated doc number carries the finding on its paragraph_check event", () =>
  withModels("", async () => {
    // repairCitations only rewrites markdown links, so this is the one finding
    // class that survives to be checked here — a bad /atlas/ link is already
    // de-linkified by the streaming citation gate before the paragraph stream
    // ever sees the text (same reasoning as incremental.test.ts).
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("That rule is defined in Q.99.42.7 of the atlas."), finishChunk("stop")]]),
      }),
    );
    const checkEvents = events.filter((e) => e.type === "paragraph_check");
    expect(checkEvents).toHaveLength(1); // flushed as the trailing paragraph — no blank line ends it
    expect(checkEvents[0].type === "paragraph_check" && checkEvents[0].findings).toEqual([
      "document number does not exist in the atlas: Q.99.42.7",
    ]);
  }));

test("the round_checks row records the incremental paragraph tally for the final burst", () =>
  withModels("", async () => {
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("First paragraph here.\n\nThat rule is defined in Q.99.42.7 of the atlas."), finishChunk("stop")]]),
      }),
    );
    const round = lastDone(events).checksMeta.find((c) => c.kind === "round_checks")!;
    const verdict = round.verdict as { incremental: { paragraphs: number; flagged: number } };
    expect(verdict.incremental).toEqual({ paragraphs: 2, flagged: 1 });
  }));

// ── Per-paragraph refutation (CHAT_REFUTE_MODE="paragraph", the default) ────
// The file above pins "answer" mode via withModels' default third argument —
// these tests opt into "paragraph" explicitly.

test("paragraph mode: one paragraph_refute event per paragraph, all landing before verify_result", () =>
  withModels(
    "strong/verifier",
    async () => {
      const jsonCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([[textChunk("First paragraph.\n\nSecond paragraph."), finishChunk("stop")]]),
          jsonCall: fakeSlicedJson({}, jsonCalls),
        }),
      );
      const refuteEvents = events.filter((e) => e.type === "paragraph_refute");
      expect(refuteEvents.map((e) => (e.type === "paragraph_refute" ? e.index : -1))).toEqual([0, 1]);
      expect(refuteEvents.every((e) => e.type === "paragraph_refute" && e.parsed && e.candidates === 0)).toBe(true);
      const verifyIdx = events.findIndex((e) => e.type === "verify_result");
      const lastRefuteIdx = events.map((e) => e.type === "paragraph_refute").lastIndexOf(true);
      expect(lastRefuteIdx).toBeLessThan(verifyIdx);
      const verify = events.find((e) => e.type === "verify_result")!;
      expect(verify.type === "verify_result" && verify.overall).toBe("pass");
      // Two refute calls (one per paragraph) + one overreach call; no confirm
      // (nothing to confirm on a clean answer).
      expect(jsonCalls).toHaveLength(3);
    },
    "paragraph",
  ));

test("paragraph mode: a per-paragraph contradiction is confirmed and reaches the wire, same as answer mode", () =>
  withModels(
    "strong/verifier",
    async () => {
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([[textChunk("Bad paragraph."), finishChunk("stop")]]),
          jsonCall: fakeSlicedJson({ refute: [sliceFail("Bad paragraph.")], confirm: [CONFIRM_AGREE] }),
        }),
      );
      const verify = events.find((e) => e.type === "verify_result")!;
      expect(verify.type === "verify_result" && verify.overall).toBe("fail");
      expect(verify.type === "verify_result" && verify.contradictions).toHaveLength(1);
      expect(verify.type === "verify_result" && verify.contradictions[0]).toMatchObject({ answer: "Bad paragraph.", evidence: REAL_SPAN });
    },
    "paragraph",
  ));

test("paragraph mode: a tool_call between bursts drops the earlier burst's refute — only the final burst's paragraph is ever reported", () =>
  withModels(
    "strong/verifier",
    async () => {
      const rounds = [
        [textChunk("Pre-tool paragraph.\n\n"), toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
        [textChunk("Post-tool paragraph."), finishChunk("stop")],
      ];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream(rounds),
          jsonCall: fakeSlicedJson({}),
        }),
      );
      // Whatever happened to the pre-tool burst's in-flight refute call, the
      // reader is never told about it — a tool_call means that draft was set
      // aside, and paragraph-refute.ts's burst tag drops it when it lands.
      const refuteEvents = events.filter((e) => e.type === "paragraph_refute");
      expect(refuteEvents).toHaveLength(1);
      expect(refuteEvents[0]!.type === "paragraph_refute" && refuteEvents[0]!.index).toBe(0);
      const verify = events.find((e) => e.type === "verify_result")!;
      expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    },
    "paragraph",
  ));

test("paragraph mode: the verify checksMeta latencyMs is the post-generation settle wait, not null", () =>
  withModels(
    "strong/verifier",
    async () => {
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([[textChunk("Answer."), finishChunk("stop")]]),
          jsonCall: fakeSlicedJson({}),
        }),
      );
      const verifyMeta = lastDone(events).checksMeta.find((m) => m.kind === "verify")!;
      // Every fixture call reports latencyMs:5 (see fakeSlicedJson) — the
      // returned number must be a real measurement, not the whole-answer
      // path's max() (which would also be non-null here, so the meaningful
      // assertion is that it's a finite, non-negative number at all).
      expect(typeof verifyMeta.latencyMs).toBe("number");
      expect(verifyMeta.latencyMs).toBeGreaterThanOrEqual(0);
    },
    "paragraph",
  ));

test("CHAT_REFUTE_MODE=answer (explicit) reproduces the pre-2026-09 sequence — no paragraph_refute events at all", () =>
  withModels(
    "strong/verifier",
    async () => {
      const jsonCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([[textChunk("Answer."), finishChunk("stop")]]),
          jsonCall: fakeSlicedJson({}, jsonCalls),
        }),
      );
      expect(events.some((e) => e.type === "paragraph_refute")).toBe(false);
      expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
      const verify = events.find((e) => e.type === "verify_result")!;
      expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    },
    "answer",
  ));
