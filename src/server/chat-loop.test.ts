// Pure agentic-loop tests. The LLM is a fake ChatStream; tools execute against
// the REAL in-memory indexes (atlas_describe/atlas_get are pg-free), so no
// network, no API key, no Postgres. Run under `bun test`.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { loadIndexes } from "./indexes.ts";
import { runChat, type ChatStream, type ChatEvent } from "./chat-loop.ts";

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
function fakeStream(rounds: Chunk[][], captured: { toolChoice: string }[]): ChatStream {
  let i = 0;
  return (params) => {
    captured.push({ toolChoice: params.toolChoice });
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

test("maxIterations=1 forces tool_choice:none on the only call", async () => {
  const captured: { toolChoice: string }[] = [];
  // Even if the model WANTS a tool, max=1 means the single call is forced to text.
  const rounds = [[toolChunk("atlas_describe", "{}"), finishChunk("tool_calls")]];
  const events = await collect(runChat({ ix, messages: [userMsg], stream: fakeStream(rounds, captured), maxIterations: 1 }));

  expect(captured).toHaveLength(1);
  expect(captured[0].toolChoice).toBe("none");
  // No tool executed; terminal done emitted.
  expect(events.some((e) => e.type === "tool_call")).toBe(false);
  expect(events.at(-1)!.type).toBe("done");
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
