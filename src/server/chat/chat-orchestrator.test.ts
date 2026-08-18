// Orchestrator tests: fake ChatStream + fake JsonCall, real in-memory indexes.
// Covers event ordering (incl. the revision sequence), the escalation gate,
// the exactly-one-recovery-cycle cap, and internal-field sanitization.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { loadIndexes } from "../retrieval/indexes.ts";
import { config } from "../config.ts";
import type { ChatStream } from "./chat-loop.ts";
import type { JsonCall } from "./llm.ts";
import { runVerifiedChat, sanitizeDone, type HarnessEvent, type HarnessDone } from "./chat-orchestrator.ts";
import { SLICES } from "./verify/sliced-verifier.ts";
import type { SliceName } from "./verify/verifier-slices.ts";
import { atlasDescribe } from "./tools/tools.ts";
import { findParamsMentioned } from "./verify/param-checks.ts";

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

// The orchestrator's only audit path is the sliced one (verify/sliced-verifier.ts):
// four concurrent auditors, one per failure class (claims/figures/sets/overreach),
// each seeing its own system prompt (verifier-slices.ts's PROMPTS) but the SAME
// evidence. A fixture therefore has to look like a SliceResult (`{claims:[{claim,
// status,span}],ruling_issued,notes}`), not the legacy single-verifier Verdict —
// and a "supported" claim is only honoured if `span` is an exact substring of the
// evidence actually passed this turn (verifier-slices.ts's validateSpans);
// "contradicted"/"unsupported" claims skip span validation entirely.
//
// [E0] schema evidence (chat-orchestrator.ts's schemaEvidence) is ALWAYS present
// regardless of tool calls, so a literal drawn from it gives every "pass" fixture
// a real, always-available span without needing a live tool round. Guarded below
// so a reword of tools.ts's atlasDescribe() output fails loudly instead of
// silently demoting these fixtures to "warn".
const REAL_SPAN = "Use atlas_entities to search/list entities by name, type, or subtype.";
test("REAL_SPAN literal used by sliced-verifier PASS fixtures is still present in atlas_describe's [E0] schema evidence", () => {
  expect(JSON.stringify(atlasDescribe(ix))).toContain(REAL_SPAN);
});

const SLICE_EMPTY = '{"claims":[],"ruling_issued":false,"notes":""}';
const slicePass = () => JSON.stringify({ claims: [{ claim: "x", status: "supported", span: REAL_SPAN }], ruling_issued: false, notes: "" });
const sliceFail = () => JSON.stringify({ claims: [{ claim: "x", status: "contradicted", span: "" }], ruling_issued: false, notes: "" });
// n unsupported claims, and ONLY from the "claims" slice — figures/sets stay
// empty — so the merged unsupportedClaims count is exactly n, not n×3. Needed
// because claims/figures/sets all feed the same merged claims array.
const sliceWarn = (n: number) =>
  JSON.stringify({ claims: Array.from({ length: n }, (_, i) => ({ claim: `u${i}`, status: "unsupported", span: "" })), ruling_issued: false, notes: "" });

// Identifies which of the four concurrent slice calls (or the differently-shaped
// recovery-advisor call) a JsonCall invocation is, by its system prompt — content
// dispatch, not call order, so it reflects production wiring rather than relying
// on Promise.all's resolution order.
const SLICE_SIGNATURE: Record<SliceName, string> = {
  claims: "factual claim", figures: "NUMBER, RATE, DATE", sets: "ENUMERATIONS", overreach: "ADJUDICATE",
};
function identifySlice(messages: Msg[]): SliceName | "advisor" {
  const sys = typeof messages[0]?.content === "string" ? messages[0].content : "";
  return SLICES.find((s) => sys.includes(SLICE_SIGNATURE[s])) ?? "advisor";
}
// `scripts[slice]` is consumed in order, once per call to that slice (its own
// counter) — so a slice hit twice in one test (e.g. fail-then-pass across a
// revision's re-verify) can script both responses. Unscripted slices get a
// neutral empty verdict.
function fakeSlicedJson(scripts: Partial<Record<SliceName | "advisor", string[]>>, calls: { model: string }[] = []): JsonCall {
  const seen: Partial<Record<SliceName | "advisor", number>> = {};
  return async ({ model, messages }) => {
    calls.push({ model });
    const msgs = messages as Msg[];
    const slice = identifySlice(msgs);
    // An unscripted "advisor" hit means either the recovery advisor genuinely
    // ran without a scripted response, or (more insidiously) a PROMPTS reword
    // in verifier-slices.ts broke SLICE_SIGNATURE's match and a real slice call
    // got misidentified as the advisor. Both are bugs in the fixture, not a
    // valid "no advisor" case — throw instead of silently returning a neutral
    // verdict, so the mismatch names itself instead of surfacing as a confusing
    // verdict downstream.
    if (slice === "advisor" && !scripts.advisor) {
      const sys = typeof msgs[0]?.content === "string" ? msgs[0].content : "";
      throw new Error(`fakeSlicedJson: unscripted "advisor" call — system prompt started: ${sys.slice(0, 120)}`);
    }
    const arr = scripts[slice] ?? [SLICE_EMPTY];
    const idx = seen[slice] ?? 0;
    seen[slice] = idx + 1;
    return { text: arr[Math.min(idx, arr.length - 1)] ?? SLICE_EMPTY, usage: { input: 10, output: 5 }, generationId: `gen-j${idx}`, latencyMs: 5 };
  };
}
// A full slice round's model list, in the deterministic claims/figures/sets/
// overreach order (Promise.all over SLICES, each call synchronous up to its
// first await — see identifySlice's doc comment).
const sliceRound = (model: string) => Array(SLICES.length).fill(model);

function withModels(verifier: string, advisor: string, fn: () => Promise<void>): Promise<void> {
  const pv = config.chatVerifierModel;
  const pa = config.chatAdvisorModel;
  const pj = config.chatSmalltalkJudgeModel;
  config.chatVerifierModel = verifier;
  config.chatAdvisorModel = advisor;
  // The judge slot defaults ON in config — zero it here so every test
  // exercises the audit path it was written for; bypass tests opt back in
  // with the nested withJudge wrapper below.
  config.chatSmalltalkJudgeModel = "";
  return fn().finally(() => {
    config.chatVerifierModel = pv;
    config.chatAdvisorModel = pa;
    config.chatSmalltalkJudgeModel = pj;
  });
}

test("no model slots: pass-through + status ticker; done carries checksMeta; sanitizeDone strips internals", () =>
  withModels("", "", async () => {
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop"), usageChunk(100, 10)],
    ];
    const events = await collect(runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream(rounds), question: "hi", maxIterations: 3 }));

    expect(kinds(events)).toEqual(["status:querying", "tool_call", "tool_result", "token", "status:comparing", "done"]);
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
// Config-gates the judge slot the same way withModels gates verifier/advisor.
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
  withModels("strong/verifier", "chat/advisor", () =>
    withJudge("fast/judge", async () => {
      const sliceCalls: { model: string }[] = [];
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hello", maxIterations: 3,
          stream: fakeStream([[textChunk(GREETING), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({ claims: [slicePass()] }, sliceCalls), '{"smalltalk": true}', judgeCalls),
        }),
      );
      // Straight to done: no comparing/checking ticker, no verify chip, no
      // slice calls — only the one judge call, recorded in checksMeta.
      expect(kinds(events)).toEqual(["token", "done"]);
      expect(judgeCalls).toEqual([{ model: "fast/judge" }]);
      expect(sliceCalls).toEqual([]);
      const done = lastDone(events);
      expect(done.content).toBe(GREETING);
      expect(done.checksMeta.map((c) => c.kind)).toEqual(["smalltalk_judge"]);
    })));

test("judge rules the question expects facts → full audit runs despite an uncheckable answer", () =>
  withModels("strong/verifier", "chat/advisor", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "is the fee governance-controlled?", maxIterations: 3,
          stream: fakeStream([[textChunk("Yes, that is governed."), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({ claims: [slicePass()] }), '{"smalltalk": false}', judgeCalls),
        }),
      );
      expect(judgeCalls.length).toBe(1);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
      expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["smalltalk_judge", "round_checks", "verify"]);
    })));

test("a zero-tool answer with groundable content is never bypassed — even a smalltalk ruling can't skip the audit", () =>
  withModels("strong/verifier", "chat/advisor", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "hi", maxIterations: 3,
          stream: fakeStream([[textChunk("A.1.6 covers that."), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({ claims: [slicePass()] }), '{"smalltalk": true}', judgeCalls),
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
  withModels("strong/verifier", "chat/advisor", () =>
    withJudge("fast/judge", async () => {
      const judgeCalls: { model: string }[] = [];
      const events = await collect(
        runVerifiedChat({
          ix, messages: [userMsg], question: "what is A.1.6?", maxIterations: 3,
          stream: fakeStream([[textChunk(GREETING), finishChunk("stop")]]),
          jsonCall: withJudgeRuling(fakeSlicedJson({ claims: [slicePass()] }), '{"smalltalk": true}', judgeCalls),
        }),
      );
      expect(judgeCalls).toEqual([]);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
    })));

test("the judge never fires past the first user message — later turns always audit", () =>
  withModels("strong/verifier", "chat/advisor", () =>
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
          jsonCall: withJudgeRuling(fakeSlicedJson({ claims: [slicePass()] }), '{"smalltalk": true}', judgeCalls),
        }),
      );
      expect(judgeCalls).toEqual([]);
      expect(events.some((e) => e.type === "verify_result")).toBe(true);
    })));

test("no judge model configured → bypass disabled outright, greetings get the full audit", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const sliceCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hello", maxIterations: 3,
        stream: fakeStream([[textChunk(GREETING), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({ claims: [slicePass()] }, sliceCalls),
      }),
    );
    expect(sliceCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
    expect(events.some((e) => e.type === "verify_result")).toBe(true);
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

test("reference-style citations are normalized to canonical inline form before repair and checks", () =>
  withModels("", "", async () => {
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
  withModels("", "", async () => {
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
  withModels("", "", async () => {
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
  withModels("", "", async () => {
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
  withModels("", "", async () => {
    const bad = "That rule is defined in Q.99.42.7 of the atlas.";
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk(bad), finishChunk("stop")]]), question: "hi", maxIterations: 3 }),
    );
    const verify = events.find((e) => e.type === "verify_result");
    expect(verify && verify.type === "verify_result" && verify.overall).toBe("fail");
    expect(verify && verify.type === "verify_result" && verify.invalidDocNos).toEqual(["Q.99.42.7"]);
  }));

test("verifier pass: checking status counts real sources, verify_result pass, no advisor call", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({ claims: [slicePass()] }, jsonCalls),
      }),
    );
    expect(kinds(events)).toEqual([
      "status:querying", "tool_call", "tool_result", "token",
      "status:comparing", "status:checking", "verify_result", "done",
    ]);
    // One tool result → one evidence entry: singular, and never "0 sources".
    const checking = events.find((e) => e.type === "status" && e.stage === "checking")!;
    expect(checking.type === "status" && checking.detail).toBe("Cross-checking the answer against 1 source…");
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier")); // advisor never ran
    expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify"]);
  }));

test("comparing status fires on a grounded turn even with no verifier model", () =>
  withModels("", "", async () => {
    // No verifier/advisor model configured — deterministic checks alone still
    // enter the verification block, so "comparing" fires even without a
    // "checking" status right behind it.
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({ ix, messages: [userMsg], question: "hi", maxIterations: 3, stream: fakeStream(rounds) }),
    );
    expect(kinds(events)).toEqual(["status:querying", "tool_call", "tool_result", "token", "status:comparing", "done"]);
  }));

test("ungrounded turn: verification stages are suppressed, the audit still runs", () =>
  withModels("strong/verifier", "", async () => {
    // Nothing retrieved this turn and no earlier turns to fall back on, so
    // there is no basis to name — "against 0 sources" must never be announced.
    // The audit itself is unchanged (a no-retrieval answer is the most
    // hallucination-prone case); only the ticker goes quiet.
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Answer."), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({ claims: [slicePass()] }),
      }),
    );
    expect(kinds(events)).toEqual(["token", "verify_result", "done"]);
    expect(lastDone(events).checksMeta.map((c) => c.kind)).toEqual(["round_checks", "verify"]);
  }));

test("no tools but earlier turns: the stages name the conversation as the basis", () =>
  withModels("strong/verifier", "", async () => {
    const history: Msg[] = [
      { role: "user", content: "what is the stability scope?" },
      { role: "assistant", content: "The Stability Scope covers…" },
      { role: "user", content: "summarize that" },
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: history, question: "summarize that", maxIterations: 3,
        stream: fakeStream([[textChunk("In short: it covers…"), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({ claims: [slicePass()] }),
      }),
    );
    const details = events.filter((e) => e.type === "status").map((e) => (e.type === "status" ? e.detail : ""));
    expect(details).toEqual([
      "Comparing the draft against the conversation so far…",
      "Cross-checking the answer against earlier turns of this conversation…",
    ]);
  }));

test("comparing status is absent when the answer is empty or checks are off", () =>
  withModels("", "", async () => {
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
  withModels("strong/verifier", "", async () => {
    // Keyed by slice (via identifySlice), not push order — "overreach" gets no
    // evidence block at all (SLICE_NEEDS_EVIDENCE.overreach === false), so
    // asserting on "whichever call landed first" would be one SLICES-order
    // change away from checking the wrong slice's prompt.
    const capturedBySlice = new Map<SliceName | "advisor", string>();
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
    const claimsPrompt = capturedBySlice.get("claims")!;
    expect(claimsPrompt).toContain("[E-const]");
    expect(claimsPrompt).toContain("atlas_param_table");
    expect(claimsPrompt).toContain(name);

    capturedBySlice.clear();
    const withoutParam = "The weather report has nothing to do with atlas governance parameters.";
    await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk(withoutParam), finishChunk("stop")]]),
        jsonCall,
      }),
    );
    expect(capturedBySlice.get("claims")).not.toContain("[E-const]");
  }));

test("sliced mode: four concurrent slice audits merge into one verdict + pass badge", () =>
  withModels("strong/verifier", "", async () => {
    // Same scripted text for all four slices: one supported absence claim
    // (span-exempt, so validation can't demote it) and no ruling. Grounded via
    // a real scaffold-tagged doc fetched this turn (src/lib/liveness.ts,
    // surfaced by tools.ts's withLivenessHint) so the absence contract
    // (verify/absence.ts, wired in sliced-verifier.ts's mergeSlices) doesn't
    // downgrade it to unverified — a bare "x" claim with no grounding at all
    // now correctly lands as unverified/warn, see the dedicated absence tests.
    const [scaffoldUuid] = [...ix.liveness.entries()].find(([, v]) => v === "scaffold")!;
    const SLICE_OK = '{"claims":[{"claim":"x","status":"supported","span":"","absence":true}],"ruling_issued":false,"notes":""}';
    const jsonCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([
          [toolChunk("atlas_get", JSON.stringify({ id: scaffoldUuid })), finishChunk("tool_calls")],
          [textChunk("Answer."), finishChunk("stop")],
        ]),
        jsonCall: fakeJson([SLICE_OK], jsonCalls),
      }),
    );
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("pass");
    const meta = lastDone(events).checksMeta.find((m) => m.kind === "verify")!;
    expect(meta.model).toBe("sliced(strong/verifier)");
  }));

test("verifier fail → advisor rewrite → revision replaces answer → re-verify once", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    // A tool round first so the turn is grounded — the verification stages are
    // suppressed on a turn with no basis to compare against (see the
    // ungrounded test above), and this test is about the revision sequence.
    const rounds = [
      [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
      [textChunk("Bad answer."), finishChunk("stop"), usageChunk(100, 10)],
      [textChunk("Fixed answer."), finishChunk("stop"), usageChunk(50, 5)],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({
          claims: [sliceFail(), slicePass()],
          advisor: ['{"action":"rewrite","guidance":"remove claim x"}'],
        }, jsonCalls),
      }),
    );

    // The plan's revision sequence, in order. "comparing" precedes only the
    // FIRST audit — the re-verify pass after revision is a separate code path
    // that the orchestrator change in this PR does not touch.
    expect(kinds(events)).toEqual([
      "status:querying", "tool_call", "tool_result", "token",
      "status:comparing", "status:checking", "verify_result",
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
    // Exactly one recovery cycle: a slice round + advisor + a recheck slice round.
    expect(jsonCalls.map((c) => c.model)).toEqual([...sliceRound("strong/verifier"), "chat/advisor", ...sliceRound("strong/verifier")]);
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
        jsonCall: fakeSlicedJson({ claims: [sliceFail()], advisor: ["sorry, no json"] }),
      }),
    );
    expect(events.filter((e) => e.type === "verify_result")).toHaveLength(1);
    expect(events.some((e) => e.type === "clear")).toBe(false);
    const done = lastDone(events);
    expect(done.content).toBe("Bad answer.");
    const advisorRow = done.checksMeta.find((c) => c.kind === "advisor_recovery")!;
    expect(advisorRow.action).toBe("annotate");
  }));

test("a lone unsupported claim warns without buying a full transcript replay", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream([[textChunk("Answer."), finishChunk("stop")]]),
        jsonCall: fakeSlicedJson({ claims: [sliceWarn(1)] }, jsonCalls),
      }),
    );
    expect(kinds(events)).toEqual(["token", "verify_result", "done"]); // ungrounded: stages stay quiet
    const verify = events.find((e) => e.type === "verify_result")!;
    expect(verify.type === "verify_result" && verify.overall).toBe("warn");
    // Amber badge, no advisor, no revision — the answer stands as written.
    expect(verify.type === "verify_result" && verify.action).toBe("annotate");
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
    expect(lastDone(events).content).toBe("Answer.");
  }));

test("enough unsupported claims still escalates: warn crosses the threshold", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    const jsonCalls: { model: string }[] = [];
    const rounds = [
      [textChunk("Thin answer."), finishChunk("stop")],
      [textChunk("Fixed answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 3,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({
          claims: [sliceWarn(config.chatAdvisorTriggerUnsupportedClaims), slicePass()],
          advisor: ['{"action":"rewrite","guidance":"cite the gaps"}'],
        }, jsonCalls),
      }),
    );
    expect(events.some((e) => e.type === "status" && e.stage === "advising")).toBe(true);
    expect(jsonCalls.map((c) => c.model)).toEqual([...sliceRound("strong/verifier"), "chat/advisor", ...sliceRound("strong/verifier")]);
    expect(lastDone(events).content).toBe("Fixed answer.");
  }));

test("a sub-threshold warn still escalates when retrieval was in trouble", () =>
  withModels("strong/verifier", "chat/advisor", async () => {
    // The `overall !== "pass"` clause is untouched by the threshold: warn plus
    // an independent trouble signal (repeated identical queries) still recovers.
    // `sliceWarn(1)` is BELOW config.chatAdvisorTriggerUnsupportedClaims (3), so
    // this only escalates via the retrieval-trouble signal, not the count gate —
    // that's the one this test exists to cover. maxIterations is deliberately
    // generous (8, against 3 rounds actually used) so `exhausted` (roundsUsed >=
    // max-1) is unambiguously false too — otherwise it, not retrievalTrouble,
    // would be silently carrying the escalation.
    const jsonCalls: { model: string }[] = [];
    const same = toolChunk("atlas_search", '{"q":"same"}');
    const rounds = [
      [same, finishChunk("tool_calls")],
      [same, finishChunk("tool_calls")],
      [textChunk("Answer."), finishChunk("stop")],
      [textChunk("Fixed answer."), finishChunk("stop")],
    ];
    const events = await collect(
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 8,
        stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({
          claims: [sliceWarn(1), slicePass()],
          advisor: ['{"action":"rewrite","guidance":"widen the search"}'],
        }, jsonCalls),
      }),
    );
    expect(events.some((e) => e.type === "status" && e.stage === "advising")).toBe(true);
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
      runVerifiedChat({
        ix, messages: [userMsg], question: "hi", maxIterations: 2, stream: fakeStream(rounds),
        jsonCall: fakeSlicedJson({ claims: [slicePass()] }, jsonCalls),
      }),
    );
    expect(jsonCalls.map((c) => c.model)).toEqual(sliceRound("strong/verifier"));
    expect(events.some((e) => e.type === "status" && e.stage === "advising")).toBe(false);
  }));
