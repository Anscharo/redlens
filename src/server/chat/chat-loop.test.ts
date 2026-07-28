// Pure agentic-loop tests. The LLM is a fake ChatStream; tools execute against
// the REAL in-memory indexes (atlas_describe/atlas_get are pg-free), so no
// network, no API key, no Postgres. Run under `bun test`.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { loadIndexes } from "../retrieval/indexes.ts";
import { runChat, type ChatStream, type ChatEvent } from "./chat-loop.ts";
import { config } from "../config.ts";

type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;
const ix = loadIndexes();

const textChunk = (text: string, id = "gen-abc"): Chunk =>
  ({ id, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) as unknown as Chunk;
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

// A fake LLM that replays `rounds` (one per loop iteration) and records the
// params it was called with.
type Captured = { toolChoice: string; messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[] };
function fakeStream(rounds: Chunk[][], captured: Captured[]): ChatStream {
  let i = 0;
  return (params) => {
    captured.push({ toolChoice: params.toolChoice, messages: params.messages });
    const chunks = rounds[Math.min(i, rounds.length - 1)] ?? [];
    i++;
    return emit(chunks);
  };
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const userMsg: OpenAI.Chat.Completions.ChatCompletionMessageParam = { role: "user", content: "hi" };

test("plain answer: streams tokens, no tools, terminal done carries usage + gen id", async () => {
  const rounds = [[textChunk("Hello "), textChunk("world"), finishChunk("stop"), usageChunk(120, 8)]];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []) }));

  expect(events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text)).toEqual(["Hello ", "world"]);
  const done = events.at(-1)!;
  expect(done.type).toBe("done");
  if (done.type === "done") {
    expect(done.content).toBe("Hello world");
    expect(done.usage).toEqual({ input: 120, output: 8 });
    expect(done.generationId).toBe("gen-abc");
    expect(done.toolCalls).toHaveLength(0);
  }
});

test("tool round: leaked pre-tool content triggers clear, then executes + answers", async () => {
  const rounds = [
    // Model leaks a <tool_call> sentinel fragment as content before the call.
    [textChunk("ool_call>"), toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
    [textChunk("Done."), finishChunk("stop"), usageChunk(200, 10)],
  ];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []) }));

  // A clear must be emitted to discard the junk, and it must precede the tool_call.
  const clearIdx = events.findIndex((e) => e.type === "clear");
  const callIdx = events.findIndex((e) => e.type === "tool_call");
  expect(clearIdx).toBeGreaterThanOrEqual(0);
  expect(clearIdx).toBeLessThan(callIdx);

  const call = events[callIdx];
  const result = events.find((e) => e.type === "tool_result");
  expect(call && call.type === "tool_call" && call.name).toBe("atlas_describe");
  expect(result && result.type === "tool_result" && result.ok).toBe(true);
  const done = events.at(-1)!;
  // done.content is the clean final round only — no leaked sentinel.
  expect(done.type === "done" && done.content).toBe("Done.");
  expect(done.type === "done" && done.toolCalls).toHaveLength(1);
});

test("tool round records chat-budget truncation metadata", async () => {
  const previousBudget = config.chatToolResultMaxChars;
  config.chatToolResultMaxChars = 300;
  const rounds = [
    [toolChunk("atlas_describe", JSON.stringify({ sections: ["all"] })), finishChunk("tool_calls")],
    [textChunk("Done."), finishChunk("stop")],
  ];
  try {
    const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []), maxIterations: 2 }));

    const result = events.find((e) => e.type === "tool_result");
    expect(result && result.type === "tool_result" && result.ok).toBe(true);
    expect(result && result.type === "tool_result" && result.truncated).toBe(true);
    expect(result && result.type === "tool_result" && result.originalBytes).toBeGreaterThan(
      result && result.type === "tool_result" ? result.bytes : 0,
    );

    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type === "done") {
      expect(done.toolCalls[0].truncated).toBe(true);
      expect(done.toolCalls[0].originalBytes).toBeGreaterThan(done.toolCalls[0].bytes);
    }
  } finally {
    config.chatToolResultMaxChars = previousBudget;
  }
});

test("final turn injects the answer-now instruction, only on the forced-text round", async () => {
  const captured: Captured[] = [];
  // Round 0 calls a tool (tool_choice auto); round 1 is the forced-text final.
  const rounds = [
    [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
    [textChunk("Answer."), finishChunk("stop")],
  ];
  await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, captured), maxIterations: 2 }));

  expect(captured).toHaveLength(2);
  const hasInstruction = (c: Captured) =>
    (c.messages ?? []).some((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("This is your final turn"));
  // Not on the tool-calling round…
  expect(captured[0].toolChoice).toBe("auto");
  expect(hasInstruction(captured[0])).toBe(false);
  // …only on the final forced-text round.
  expect(captured[1].toolChoice).toBe("none");
  expect(hasInstruction(captured[1])).toBe(true);
});

test("maxIterations=1 forces tool_choice:none on the only call", async () => {
  const captured: Captured[] = [];
  // Even if the model WANTS a tool, max=1 means the single call is forced to text.
  const rounds = [[toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")]];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, captured), maxIterations: 1 }));

  expect(captured).toHaveLength(1);
  expect(captured[0].toolChoice).toBe("none");
  // No tool executed; terminal done emitted.
  expect(events.some((e) => e.type === "tool_call")).toBe(false);
  expect(events.at(-1)!.type).toBe("done");
});

test("early-answer nudge rides mid-loop rounds after the first tool round only", async () => {
  const captured: Captured[] = [];
  const rounds = [
    [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
    [toolChunk("atlas_describe", '{"sections":["all"]}'), finishChunk("tool_calls")],
    [textChunk("Answer."), finishChunk("stop")],
  ];
  await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, captured), maxIterations: 5 }));

  const hasNudge = (c: Captured) =>
    (c.messages ?? []).some(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("write the final answer now instead of calling more tools"),
    );
  expect(captured).toHaveLength(3);
  expect(hasNudge(captured[0])).toBe(false); // first round: let it search freely
  expect(hasNudge(captured[1])).toBe(true); // evidence exists → nudge
  expect(hasNudge(captured[2])).toBe(true); // still mid-loop (max 5)
  // Transient: the nudge never accumulates into the persisted msgs — each
  // request carries exactly one steering system message.
  const steeringCount = (captured[2].messages ?? []).filter(
    (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("final answer now"),
  ).length;
  expect(steeringCount).toBe(1);
});

test("done carries the full transcript: tool round + final answer", async () => {
  const rounds = [
    [toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")],
    [textChunk("Answer."), finishChunk("stop")],
  ];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []), maxIterations: 3 }));
  const done = events.at(-1)!;
  expect(done.type).toBe("done");
  if (done.type === "done") {
    const roles = done.transcript.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    const last = done.transcript.at(-1)!;
    expect(last.role === "assistant" && last.content).toBe("Answer.");
  }
});

test("multi-call round: parallel execution keeps call order; onRoundEnd sees calls + results", async () => {
  const twoCalls: Chunk = {
    id: "gen-abc",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: "call_a", type: "function", function: { name: "atlas_describe", arguments: "{}" } },
            { index: 1, id: "call_b", type: "function", function: { name: "atlas_describe", arguments: '{"sections":["doc_types"]}' } },
          ],
        },
        finish_reason: null,
      },
    ],
  } as unknown as Chunk;
  const rounds = [
    [twoCalls, finishChunk("tool_calls")],
    [textChunk("Done."), finishChunk("stop")],
  ];
  const roundEnds: Parameters<NonNullable<Parameters<typeof runChat>[0]["onRoundEnd"]>>[0][] = [];
  const events = await collect(
    runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []), maxIterations: 3, onRoundEnd: (info) => roundEnds.push(info) }),
  );

  // Both tool_call events precede both tool_result events (batch execution)…
  const kinds = events.filter((e) => e.type === "tool_call" || e.type === "tool_result").map((e) => e.type);
  expect(kinds).toEqual(["tool_call", "tool_call", "tool_result", "tool_result"]);
  // …and the transcript pairs each tool message to its call id in call order.
  const done = events.at(-1)!;
  if (done.type === "done") {
    const toolMsgs = done.transcript.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.role === "tool" && m.tool_call_id)).toEqual(["call_a", "call_b"]);
  }
  expect(roundEnds).toHaveLength(1);
  expect(roundEnds[0].iter).toBe(0);
  expect(roundEnds[0].calls.map((c) => c.name)).toEqual(["atlas_describe", "atlas_describe"]);
  expect(roundEnds[0].results).toHaveLength(2);
  expect(roundEnds[0].results.every((r) => r.ok)).toBe(true);
});

test("tool round executes even when finish_reason is 'stop' instead of 'tool_calls'", async () => {
  // Some providers behind model-router.ts's OpenRouter fallback chain report
  // finish_reason:"stop" for a round that still streamed tool_calls deltas.
  // The loop must trust the accumulated pending calls, not the finish_reason.
  const rounds = [
    [toolChunk("atlas_describe", "{}"), finishChunk("stop")],
    [textChunk("Done."), finishChunk("stop")],
  ];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []), maxIterations: 3 }));

  const call = events.find((e) => e.type === "tool_call");
  const result = events.find((e) => e.type === "tool_result");
  expect(call && call.type === "tool_call" && call.name).toBe("atlas_describe");
  expect(result && result.type === "tool_result" && result.ok).toBe(true);
  const done = events.at(-1)!;
  expect(done.type === "done" && done.content).toBe("Done.");
  expect(done.type === "done" && done.toolCalls).toHaveLength(1);
  if (done.type === "done") {
    expect(done.transcript.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
  }
});

test("finish_reason 'length' never executes a pending tool call — falls through to lengthCapped", async () => {
  // A cut-off stream leaves pending.arguments as truncated JSON. Executing it
  // would run the tool with wrong/empty args and hide the truncation, so this
  // must fall through to the answer path and report lengthCapped, not silently
  // treat the truncated call as a normal tool round.
  const rounds = [[toolChunk("atlas_describe", '{"sec'), finishChunk("length")]];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []), maxIterations: 3 }));

  expect(events.some((e) => e.type === "tool_call")).toBe(false);
  expect(events.some((e) => e.type === "tool_result")).toBe(false);
  const done = events.at(-1)!;
  expect(done.type).toBe("done");
  expect(done.type === "done" && done.lengthCapped).toBe(true);
  expect(done.type === "done" && done.toolCalls).toHaveLength(0);
});

test("a pending slot with no id/name is not executed and the round falls through to a plain answer", async () => {
  // A malformed delta: an index that streams arguments but never gets a
  // function name or call id (e.g. stream cut short). It must not reach
  // execToolDetailed (no tool to call, no id for a "tool" message) — the
  // round should behave as if no tool_calls had streamed at all.
  const malformedToolChunk: Chunk = {
    id: "gen-abc",
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, finish_reason: null }],
  } as unknown as Chunk;
  const rounds = [[malformedToolChunk, finishChunk("stop")]];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, []), maxIterations: 3 }));

  expect(events.some((e) => e.type === "tool_call")).toBe(false);
  expect(events.some((e) => e.type === "tool_result")).toBe(false);
  const done = events.at(-1)!;
  expect(done.type).toBe("done");
  expect(done.type === "done" && done.content).toBe("");
  expect(done.type === "done" && done.toolCalls).toHaveLength(0);
});

test("aborted signal short-circuits to a terminal done", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const events = await collect(
    runChat({ ix, messages: [userMsg], stream: fakeStream([[textChunk("x")]], []), signal: ctrl.signal }),
  );
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("done");
  expect(events[0].type === "done" && events[0].content).toBe("");
});
