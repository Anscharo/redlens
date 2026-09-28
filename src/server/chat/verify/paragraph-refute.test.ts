// paragraph-refute.ts: burst tagging, the concurrency semaphore, deadline
// handling, and the batching of paragraphs beyond maxParagraphs.
import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { buildIndexes } from "../../retrieval/indexes.ts";
import type { JsonCall } from "../llm.ts";
import { createParagraphRefuter, type ScreenFn } from "./paragraph-refute.ts";
import { mergeParagraphRefutes } from "./paragraph-merge.ts";
import type { ScreenResult } from "./refute-screen.ts";
import { config } from "../../config.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const ix = buildIndexes([], [], [], {});
const CLEAN = '{"contradictions":[],"not_found":[],"notes":""}';
// Screen OFF here so these burst/semaphore tests are deterministic whatever
// CHAT_REFUTE_SCREEN says; the screen modes have their own tests below.
const base = {
  model: "m", ix, question: "q", evidence: () => [], signal: undefined,
  timeoutMs: 5000, screenMode: "off" as const,
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

// ── Jev screen modes (CHAT_REFUTE_SCREEN) ────────────────────────────────────
// An injected screen stands in for refute-screen.ts's screenParagraph, and a
// fixture gemma returns ONE span-valid contradiction, so "gemma's outcome" is
// a real candidate that survived validateContradictions.
const PARA = "The Operational Multisig threshold is 7 of 9.";
const EVIDENCE = [{ label: "[E1]", tool: "atlas_get", args: "", content: "The Operational Multisig threshold is 3 of 5." }];
const CONTRA = JSON.stringify({
  contradictions: [{ answer_span: PARA, evidence_span: "The Operational Multisig threshold is 3 of 5.", why: "3 of 5, not 7 of 9" }],
  not_found: [], notes: "",
});
function gemma(text: string): { call: JsonCall; calls: () => number } {
  let n = 0;
  const call: JsonCall = async () => (n++, { text, usage: { input: 10, output: 5 }, generationId: "g", latencyMs: 3 });
  return { call, calls: () => n };
}
const screenOf = (over: Partial<ScreenResult>): ScreenResult => ({
  flagged: false, maxContradicted: 0.05, statements: [{ text: PARA, verdict: "consistent", p: 0.05 }], fits: true,
  latencyMs: 7, estTokens: 900, inputTokens: 880, costUsd: 0.0002, generationId: "gen-dec", ...over,
});
const withScreen = (mode: "shadow" | "gate", call: JsonCall, screen: ScreenFn) =>
  createParagraphRefuter({ ...base, evidence: () => EVIDENCE, call, concurrency: 2, maxParagraphs: 100, screenMode: mode, screen });

test("shadow never changes gemma's outcome — a flagging, a clean, a failed and a throwing screen all leave it byte-identical to off", async () => {
  const off = createParagraphRefuter({ ...base, evidence: () => EVIDENCE, call: gemma(CONTRA).call, concurrency: 2, maxParagraphs: 100 });
  off.submit(0, PARA);
  const [ref] = await off.settle(5000);
  expect(ref.contradictions).toHaveLength(1);
  const screens: ScreenFn[] = [
    async () => screenOf({ flagged: true, maxContradicted: 0.9 }),
    async () => screenOf({}),
    async () => null,
    async () => { throw new Error("boom"); },
  ];
  for (const screen of screens) {
    const g = gemma(CONTRA);
    const r = withScreen("shadow", g.call, screen);
    r.submit(0, PARA);
    const [out] = await r.settle(5000);
    const { screen: s, ...rest } = out;
    expect(rest).toEqual(ref);
    expect(g.calls()).toBe(1);
    expect(s?.mode).toBe("shadow");
  }
});

test("shadow records the screen beside gemma, and the merge persists it on Verdict.paragraphs.screen", async () => {
  const r = withScreen("shadow", gemma(CONTRA).call, async () => screenOf({ flagged: true, maxContradicted: 0.88, statements: [{ text: PARA, verdict: "contradicted", p: 0.88 }] }));
  r.submit(0, PARA);
  const results = await r.settle(5000);
  const merged = mergeParagraphRefutes(results).paragraphs;
  expect(merged.screen).toEqual([{
    index: 0, mode: "shadow", status: "judged", p: 0.88, ps: [0.88], flagged: true, top: PARA,
    estTokens: 900, inputTokens: 880, ms: 7, costUsd: 0.0002, gemma: { ran: true, parsed: true, timedOut: false, candidates: 1 },
  }]);
  // Screen off ⇒ no `screen` key at all, so today's persisted shape is unchanged.
  expect("screen" in mergeParagraphRefutes([{ ...results[0], screen: undefined }]).paragraphs).toBe(false);
});

test("shadow never holds gemma back: its result lands (and frees the slot) while the screen is still running", async () => {
  let release!: (s: ScreenResult | null) => void;
  const hanging: ScreenFn = () => new Promise((r) => (release = r));
  const g = gemma(CONTRA);
  const r = createParagraphRefuter({ ...base, evidence: () => EVIDENCE, call: g.call, concurrency: 1, maxParagraphs: 100, screenMode: "shadow", screen: hanging });
  r.submit(0, PARA);
  r.submit(1, PARA); // concurrency 1: can only start once paragraph 0 has released its slot
  await new Promise((res) => setTimeout(res, 30));
  expect(r.drain().map((x) => x.index)).toEqual([0, 1]); // both landed while both screens still hang
  expect(g.calls()).toBe(2);
  const pending = await r.settle(1000);
  expect(pending[0].screen).toEqual({ mode: "shadow", result: null, pending: true });
  expect(mergeParagraphRefutes(pending).paragraphs.screen?.[0].status).toBe("pending");
  release(screenOf({}));
  await new Promise((res) => setTimeout(res, 0));
  const landed = await r.settle(1000);
  expect(landed[1].screen?.result?.flagged).toBe(false);
  expect(landed[1].contradictions).toHaveLength(1);
});

test("shadow keeps a landed screen even when gemma's call for that paragraph times out", async () => {
  const hung: JsonCall = () => new Promise(() => {});
  const r = withScreen("shadow", hung, async () => screenOf({ flagged: true, maxContradicted: 0.7 }));
  r.submit(0, PARA);
  const [out] = await r.settle(50);
  expect(out).toMatchObject({ timedOut: true, parsed: false });
  expect(out.screen?.result?.flagged).toBe(true);
});

test("gate skips gemma on a clean screen: audited clean, parsed, marked screened", async () => {
  const g = gemma(CONTRA);
  const r = withScreen("gate", g.call, async () => screenOf({}));
  r.submit(0, PARA);
  const [out] = await r.settle(5000);
  expect(g.calls()).toBe(0);
  expect(out).toMatchObject({ index: 0, contradictions: [], parsed: true, timedOut: false, screened: true, latencyMs: 7 });
  expect(mergeParagraphRefutes([out]).parsed).toBe(true); // a skipped paragraph must not flip refuteParsed
});

test("gate calls gemma when the screen flags, doesn't fit, judged nothing, or failed", async () => {
  const cases: [string, ScreenFn][] = [
    ["flagged", async () => screenOf({ flagged: true, maxContradicted: 0.3 })],
    ["unfit", async () => screenOf({ fits: false, statements: [] })],
    ["empty", async () => screenOf({ statements: [] })],
    ["null", async () => null],
    ["throws", async () => { throw new Error("boom"); }],
  ];
  for (const [label, screen] of cases) {
    const g = gemma(CONTRA);
    const r = withScreen("gate", g.call, screen);
    r.submit(0, PARA);
    const [out] = await r.settle(5000);
    expect({ label, calls: g.calls(), contradictions: out.contradictions.length, screened: out.screened }).toEqual({ label, calls: 1, contradictions: 1, screened: undefined });
  }
});

test("an unrecognised mode normalizes to shadow; a missing screen means off", async () => {
  const g = gemma(CONTRA);
  const r = withScreen("gated" as "gate", g.call, async () => screenOf({}));
  r.submit(0, PARA);
  const [out] = await r.settle(5000);
  expect(g.calls()).toBe(1);
  expect(out.screen?.mode).toBe("shadow");
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = ""; // the default screen needs a key — without one the screen is off
  try {
    const r2 = createParagraphRefuter({ ...base, evidence: () => EVIDENCE, call: gemma(CONTRA).call, concurrency: 1, maxParagraphs: 100, screenMode: "gate" });
    r2.submit(0, PARA);
    const [o2] = await r2.settle(5000);
    expect(o2.screen).toBeUndefined();
    expect(o2.contradictions).toHaveLength(1);
  } finally {
    config.openrouterApiKey = prevKey;
  }
});
