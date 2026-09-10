// paragraph-refute.ts: burst tagging, the concurrency semaphore, deadline
// handling, and the batching of paragraphs beyond maxParagraphs.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { buildIndexes } from "../../retrieval/indexes.ts";
import type { JsonCall } from "../llm.ts";
import { createParagraphRefuter } from "./paragraph-refute.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const ix = buildIndexes([], [], [], {});
const CLEAN = '{"contradictions":[],"not_found":[],"notes":""}';
const base = {
  model: "m", ix, question: "q", evidence: () => [], signal: undefined,
  timeoutMs: 5000,
};

function fakeCall(delayMs = 5): { call: JsonCall; concurrentCounts: number[] } {
  let active = 0;
  const concurrentCounts: number[] = [];
  const call: JsonCall = async () => {
    active++;
    concurrentCounts.push(active);
    await new Promise((r) => setTimeout(r, delayMs));
    active--;
    return { text: CLEAN, usage: { input: 1, output: 1 }, generationId: "g", latencyMs: delayMs };
  };
  return { call, concurrentCounts };
}

test("5 paragraphs at concurrency 2 land in submit order, never more than 2 in flight at once", async () => {
  const { call, concurrentCounts } = fakeCall();
  const refuter = createParagraphRefuter({ ...base, call, concurrency: 2, maxParagraphs: 100 });
  for (let i = 0; i < 5; i++) refuter.submit(i, `paragraph ${i}`);
  const results = await refuter.settle(5000);
  expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  expect(results.every((r) => r.parsed && !r.timedOut)).toBe(true);
  expect(Math.max(...concurrentCounts)).toBeLessThanOrEqual(2);
});

test("reset() drops results of the old burst — even ones that resolve later", async () => {
  const resolvers: ((v: Awaited<ReturnType<JsonCall>>) => void)[] = [];
  const call: JsonCall = () => new Promise((resolve) => resolvers.push(resolve));
  const refuter = createParagraphRefuter({ ...base, call, concurrency: 2, maxParagraphs: 100 });

  refuter.submit(0, "old paragraph"); // starts immediately (concurrency headroom)
  await Promise.resolve();
  await Promise.resolve();
  expect(resolvers).toHaveLength(1);

  refuter.reset(); // new burst — the in-flight call above is now stale
  refuter.submit(0, "new paragraph"); // same index, new burst
  await Promise.resolve();
  await Promise.resolve();
  expect(resolvers).toHaveLength(2);

  // Resolve the OLD call with a real contradiction. If burst-tagging didn't
  // work this would corrupt the new burst's result when it lands.
  resolvers[0]!({
    text: '{"contradictions":[{"answer_span":"old paragraph","evidence_span":"y","why":"w"}],"not_found":[],"notes":""}',
    usage: { input: 1, output: 1 }, generationId: "old", latencyMs: 1,
  });
  await Promise.resolve();
  await Promise.resolve();
  // Resolve the NEW call clean.
  resolvers[1]!({ text: CLEAN, usage: { input: 1, output: 1 }, generationId: "new", latencyMs: 1 });

  const results = await refuter.settle(1000);
  expect(results).toHaveLength(1);
  expect(results[0]!.index).toBe(0);
  expect(results[0]!.contradictions).toEqual([]); // the new burst's clean result, not the old one's
});

test("settle() returns timedOut for a hung call within the deadline, not after it", async () => {
  const hungCall: JsonCall = () => new Promise(() => {}); // never resolves
  const refuter = createParagraphRefuter({ ...base, call: hungCall, concurrency: 2, maxParagraphs: 100 });
  refuter.submit(0, "paragraph");
  const start = Date.now();
  const results = await refuter.settle(50);
  expect(Date.now() - start).toBeLessThan(1000);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ index: 0, text: "paragraph", parsed: false, timedOut: true });
});

test("paragraphs at or beyond maxParagraphs are concatenated into ONE extra call, keyed by the first overflow index", async () => {
  const calls: Msg[][] = [];
  const call: JsonCall = async ({ messages }) => {
    calls.push(messages as Msg[]);
    return { text: CLEAN, usage: { input: 1, output: 1 }, generationId: "g", latencyMs: 1 };
  };
  const refuter = createParagraphRefuter({ ...base, call, concurrency: 3, maxParagraphs: 3 });
  // 0,1,2 run individually (under the cap); 3,4 overflow into one batched call.
  for (let i = 0; i < 5; i++) refuter.submit(i, `paragraph ${i}`);
  const results = await refuter.settle(5000);

  expect(calls).toHaveLength(4); // 3 individual + 1 batch
  expect(results.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  const batchMsg = calls[3]!.find((m) => typeof m.content === "string" && (m.content as string).includes("paragraph 3"))!;
  expect(batchMsg.content as string).toContain("paragraph 4");
});

test("reset() never lets the new burst exceed concurrency, even with a queued old-burst task still pending a slot", async () => {
  const { call, concurrentCounts } = fakeCall(10);
  const refuter = createParagraphRefuter({ ...base, call, concurrency: 2, maxParagraphs: 100 });
  // 3 paragraphs at concurrency 2: 0 and 1 start immediately, 2 is queued
  // (waiting for a slot) — this is the old burst's queued waiter reset()
  // must not silently drop or let corrupt the semaphore count.
  refuter.submit(0, "a");
  refuter.submit(1, "b");
  refuter.submit(2, "c");
  await Promise.resolve();
  await Promise.resolve();

  refuter.reset(); // new burst — 0/1 are still running, 2 is still queued
  refuter.submit(0, "x");
  refuter.submit(1, "y");

  const results = await refuter.settle(5000);
  // Only the NEW burst's two paragraphs are ever reported.
  expect(results.map((r) => r.index)).toEqual([0, 1]);
  expect(results.every((r) => r.parsed)).toBe(true);
  // Never more than `concurrency` calls in flight at once, across both bursts —
  // this is exactly what a corrupted (negative) `active` count would violate.
  expect(Math.max(...concurrentCounts)).toBeLessThanOrEqual(2);
});

test("drain() returns what landed since the last drain, independently of settle() having also observed it", async () => {
  const { call } = fakeCall(1);
  const refuter = createParagraphRefuter({ ...base, call, concurrency: 5, maxParagraphs: 100 });
  refuter.submit(0, "a");
  expect(refuter.drain()).toEqual([]); // nothing landed yet
  const settled = await refuter.settle(5000);
  expect(settled.map((r) => r.index)).toEqual([0]);
  // settle() does not consume drain()'s own queue — a caller that never
  // drained mid-stream still gets the result once from drain() here, which is
  // exactly why the orchestrator tracks which indices it already yielded.
  expect(refuter.drain().map((r) => r.index)).toEqual([0]);
  // A second drain() call sees nothing new.
  expect(refuter.drain()).toEqual([]);
});
