// Per-paragraph refute auditor (docs/chat-system.md §6.1, CHAT_REFUTE_MODE=
// "paragraph", the default). Runs the SAME `refute` slice (verifier-slices.ts)
// per paragraph as it closes during streaming instead of once over the
// finished answer — the recall lever (per-paragraph reading catches
// contradictions a whole-answer read stays silent on) and the latency lever
// (the verdict is mostly ready by generation end). Each call is span-validated
// against the paragraph text it was given, so answer-span validation is per
// paragraph automatically (runSlice already calls validateContradictions).
//
// Bursts: `reset()` bumps an integer tag; a call started under an old burst
// writes nothing when it lands (checked at land time), so a `tool_call`/
// `clear` that sets the draft aside drops stale results without cancelling
// in-flight requests. Concurrency is a simple semaphore. Paragraphs at or
// beyond `maxParagraphs` are buffered and concatenated into ONE extra call at
// `settle()` time — every call carries the full evidence set, so call count,
// not paragraph count, scales input tokens.
import type { JsonCall } from "../llm.ts";
import { callWithTimeout } from "../llm.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { captureEvent, type ErrorContext } from "../../posthog-node.ts";
import type { Contradiction, EvidenceEntry } from "./verifier.ts";
import { runSlice } from "./verifier-slices.ts";

export interface ParagraphRefute {
  index: number;
  text: string;
  contradictions: Contradiction[];
  notFound: string[];
  discarded: number;
  parsed: boolean;
  latencyMs: number | null;
  usage: { input: number; output: number } | null;
  timedOut: boolean;
}

export interface ParagraphRefuter {
  /** Queue a paragraph of the CURRENT burst. */
  submit(index: number, text: string): void;
  /** New burst: results of the old one are dropped when they land. */
  reset(): void;
  /** Results landed since the last drain (mid-stream events), current burst only. */
  drain(): ParagraphRefute[];
  /** Wait for every submitted paragraph of the current burst, at most deadlineMs. */
  settle(deadlineMs: number): Promise<ParagraphRefute[]>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const timedOutRefute = (index: number, text: string): ParagraphRefute => ({
  index, text, contradictions: [], notFound: [], discarded: 0, parsed: false, latencyMs: null, usage: null, timedOut: true,
});

export function createParagraphRefuter(opts: {
  call: JsonCall;
  model: string;
  ix: Indexes;
  question: string;
  evidence: (paragraphText: string) => EvidenceEntry[];
  signal?: AbortSignal;
  timeoutMs: number;
  concurrency: number;
  maxParagraphs: number;
  obs?: ErrorContext;
}): ParagraphRefuter {
  let burst = 0;
  let active = 0;
  const waiters: (() => void)[] = [];
  const textByIndex = new Map<number, string>();
  const overflow: number[] = [];
  const inFlight = new Map<number, Promise<void>>();
  const results = new Map<number, ParagraphRefute>();
  let landed: number[] = [];

  const acquire = (): Promise<void> => (active < opts.concurrency ? (active++, Promise.resolve()) : new Promise((r) => waiters.push(r)));
  function release(): void {
    active--;
    const next = waiters.shift();
    if (next) (active++, next());
  }

  async function runOne(index: number, text: string): Promise<ParagraphRefute> {
    const timed: JsonCall = (args) => callWithTimeout(opts.call, args, opts.timeoutMs, opts.signal);
    try {
      const res = await runSlice({
        call: timed, model: opts.model, slice: "refute",
        question: opts.question, answer: text, evidence: opts.evidence(text), signal: opts.signal,
      });
      if (!res.parsed) captureEvent("chat_slice_unparseable", opts.obs, { slice: "refute", paragraph: index });
      return {
        index, text, contradictions: res.contradictions, notFound: res.notFound, discarded: res.discarded,
        parsed: res.parsed, latencyMs: res.latencyMs, usage: res.usage, timedOut: false,
      };
    } catch {
      captureEvent("chat_slice_unparseable", opts.obs, { slice: "refute", paragraph: index });
      return { index, text, contradictions: [], notFound: [], discarded: 0, parsed: false, latencyMs: null, usage: null, timedOut: false };
    }
  }

  function startTask(key: number, text: string): void {
    const myBurst = burst;
    inFlight.set(
      key,
      (async () => {
        await acquire();
        try {
          const result = await runOne(key, text);
          if (myBurst !== burst) return; // stale burst — dropped, never written
          results.set(key, result);
          landed.push(key);
        } finally {
          release();
        }
      })(),
    );
  }

  return {
    submit(index, text) {
      textByIndex.set(index, text);
      if (index >= opts.maxParagraphs) overflow.push(index);
      else startTask(index, text);
    },
    reset() {
      // NOT `active`/`waiters`: a still-running old-burst task holds a real
      // semaphore slot and will call release() when it lands (the myBurst
      // check only skips WRITING its result, not its own cleanup) — zeroing
      // `active` here would double-count that later release() and drive it
      // negative, letting the new burst exceed `concurrency`. An old-burst
      // task still queued in `waiters` may get a slot back before a new-burst
      // one does; it runs to completion and is discarded the same way, which
      // costs one wasted call in that rare case, never a wrong result.
      burst++;
      textByIndex.clear();
      overflow.length = 0;
      inFlight.clear();
      results.clear();
      landed = [];
    },
    drain() {
      const out = landed.map((k) => results.get(k)!);
      landed = [];
      return out;
    },
    async settle(deadlineMs) {
      if (overflow.length > 0 && !inFlight.has(overflow[0])) {
        const key = overflow[0];
        const combined = overflow.map((i) => textByIndex.get(i) ?? "").join("\n\n");
        textByIndex.set(key, combined);
        startTask(key, combined);
      }
      const deadline = sleep(deadlineMs);
      await Promise.all([...inFlight.values()].map((p) => Promise.race([p, deadline])));
      const keys = [...new Set([...results.keys(), ...inFlight.keys()])].sort((a, b) => a - b);
      return keys.map((key) => results.get(key) ?? timedOutRefute(key, textByIndex.get(key) ?? ""));
    },
  };
}
