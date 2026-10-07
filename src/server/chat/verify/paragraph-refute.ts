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
// `settle()` time. Every call still carries the full evidence set, so call
// count rather than paragraph count is what scales input tokens; the section
// order that lets a provider cache reuse that set across the calls belongs to
// `buildRefutePrompt` (refute.ts) and is explained there. A paragraph with
// nothing checkable (`hasCheckableContent`) is recorded clean in `submit` and
// never reaches a call, a slot, or the maxParagraphs budget.
//
// Jev screen (refute-screen.ts, CHAT_REFUTE_SCREEN), inside the same semaphore
// slot so a long answer can't fan out into a burst of Jev calls:
//   "shadow" — screen and gemma start together; gemma's result lands (event,
//              slot release) the moment gemma does, exactly as without the
//              screen, which finishes under its own deadline and is attached
//              at settle() for measurement (persisted via Verdict.paragraphs).
//   "gate"   — screen first; gemma only when it flags, doesn't fit, or fails.
//              A skipped paragraph is audited-clean with `screened: true`.
//   "off"    — no screen (also: empty CHAT_REFUTE_SCREEN_MODEL or no API key).
import type { JsonCall } from "../llm.ts";
import { callWithTimeout } from "../llm.ts";
import { config } from "../../config.ts";
import { sleep } from "../../retry.ts";
import { createSemaphore } from "../../pool.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { captureEvent, type ErrorContext } from "../../posthog-node.ts";
import type { Contradiction, EvidenceEntry } from "./verifier.ts";
import { runSlice } from "./verifier-slices.ts";
import { hasCheckableContent, needsGemma, screenParagraph, type ScreenResult } from "./refute-screen.ts";

export type RefuteScreenMode = "off" | "shadow" | "gate";
export type ScreenFn = (text: string, evidence: EvidenceEntry[]) => Promise<ScreenResult | null>;

export interface ParagraphRefute {
  index: number;
  text: string;
  contradictions: Contradiction[];
  discarded: number;
  parsed: boolean;
  latencyMs: number | null;
  usage: { input: number; output: number } | null;
  timedOut: boolean;
  /**
   * The Jev screen for this call; absent when the screen is off. `result: null` = the screen failed,
   * or (`pending`) had not landed by settle() — shadow never waits for it.
   */
  screen?: { mode: "shadow" | "gate"; result: ScreenResult | null; pending?: true };
  /** Gate mode only: gemma was skipped on a clean screen — audited clean on the screen's word. */
  screened?: boolean;
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

/**
 * The no-candidates, no-cost result shape. One source of these defaults, so a
 * field added to ParagraphRefute is reasoned about once rather than at each of
 * the places that build an empty one.
 */
const blankRefute = (index: number, text: string): ParagraphRefute => ({
  index, text, contradictions: [], discarded: 0, parsed: false, latencyMs: null, usage: null, timedOut: false,
});
/** A call that reached the model but produced no usable verdict. */
const failedRefute = (index: number, text: string, timedOut: boolean): ParagraphRefute => ({
  ...blankRefute(index, text), timedOut,
});
/** Nothing to audit (a heading, a rule). Parsed clean so the backbone does not go unverified. */
const uncheckedRefute = (index: number, text: string): ParagraphRefute => ({
  ...blankRefute(index, text), parsed: true,
});

/** Normalizes the mode; a typo'd value falls to "shadow", which never changes what the reader sees. */
function resolveMode(mode: string | undefined, fn: ScreenFn | null): RefuteScreenMode {
  if (!fn || mode === "off") return "off";
  return mode === "gate" ? "gate" : "shadow";
}

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
  /** Defaults to config.chatRefuteScreen. */
  screenMode?: RefuteScreenMode;
  /** Test seam; defaults to screenParagraph with config.chatRefuteScreenModel. */
  screen?: ScreenFn;
}): ParagraphRefuter {
  const defaultScreen: ScreenFn | null =
    config.chatRefuteScreenModel && config.openrouterApiKey
      ? (text, evidence) =>
          screenParagraph({ question: opts.question, paragraph: text, evidence, ix: opts.ix, model: config.chatRefuteScreenModel, signal: opts.signal, obs: opts.obs })
      : null;
  const screenFn = opts.screen ?? defaultScreen;
  const mode = resolveMode(opts.screenMode ?? config.chatRefuteScreen, screenFn);

  let burst = 0;
  // Outside the per-burst state reset() clears: see the note in reset().
  const slots = createSemaphore(opts.concurrency);
  const textByIndex = new Map<number, string>();
  const overflow: number[] = [];
  const inFlight = new Map<number, Promise<void>>();
  const results = new Map<number, ParagraphRefute>();
  // Screens by call key, written when they start (pending) and when they land
  // — kept even when gemma's call never landed (a gemma timeout is exactly the
  // case the screen is measured against), and the only place a shadow screen
  // is recorded, since shadow never holds gemma's result back for it.
  const screens = new Map<number, NonNullable<ParagraphRefute["screen"]>>();
  let landed: number[] = [];

  async function gemmaOne(index: number, text: string, evidence: EvidenceEntry[] | null): Promise<ParagraphRefute> {
    const timed: JsonCall = (args) => callWithTimeout(opts.call, args, opts.timeoutMs, opts.signal);
    try {
      if (!evidence) throw new Error("evidence unavailable");
      const res = await runSlice({
        call: timed, model: opts.model, slice: "refute",
        question: opts.question, answer: text, evidence, signal: opts.signal,
      });
      if (!res.parsed) captureEvent("chat_slice_unparseable", opts.obs, { slice: "refute", paragraph: index });
      return {
        index, text, contradictions: res.contradictions, discarded: res.discarded,
        parsed: res.parsed, latencyMs: res.latencyMs, usage: res.usage, timedOut: false,
      };
    } catch {
      captureEvent("chat_slice_unparseable", opts.obs, { slice: "refute", paragraph: index });
      return failedRefute(index, text, false);
    }
  }

  async function screenOne(index: number, text: string, evidence: EvidenceEntry[] | null, myBurst: number): Promise<ScreenResult | null> {
    const tag = mode === "gate" ? "gate" : "shadow"; // only ever called with the screen on
    if (myBurst === burst) screens.set(index, { mode: tag, result: null, pending: true });
    let result: ScreenResult | null = null;
    try {
      result = evidence && screenFn ? await screenFn(text, evidence) : null;
    } catch {
      result = null; // an injected screen that throws is a failed screen, never a failed turn
    }
    if (myBurst === burst) screens.set(index, { mode: tag, result });
    return result;
  }

  function report(index: number, s: ScreenResult | null, r: ParagraphRefute): void {
    captureEvent("chat_refute_screen", opts.obs, {
      mode, paragraph: index, failed: s === null, flagged: s?.flagged ?? null, p: s?.maxContradicted ?? null,
      fits: s?.fits ?? null, statements: s?.statements.length ?? null, latency_ms: s?.latencyMs ?? null,
      gemma_ran: !r.screened, gemma_candidates: r.contradictions.length,
    });
  }

  async function runOne(index: number, text: string, myBurst: number): Promise<ParagraphRefute> {
    let evidence: EvidenceEntry[] | null = null;
    try {
      evidence = opts.evidence(text);
    } catch {
      evidence = null; // gemmaOne reports it exactly as the evidence throwing inside its call did
    }
    if (mode === "off") return gemmaOne(index, text, evidence);
    if (mode === "shadow") {
      const gemma = gemmaOne(index, text, evidence); // started first: the screen's request build never precedes it
      const screening = screenOne(index, text, evidence, myBurst); // never rejects; lands in `screens`
      const r = await gemma;
      void screening.then((s) => report(index, s, r));
      return r;
    }
    const s = await screenOne(index, text, evidence, myBurst);
    const r: ParagraphRefute = needsGemma(s, text)
      ? await gemmaOne(index, text, evidence)
      : { ...blankRefute(index, text), parsed: true, latencyMs: s!.latencyMs, screened: true };
    report(index, s, r);
    return { ...r, screen: { mode, result: s } };
  }

  /** The one place a result becomes visible to drain()/settle(). */
  function land(key: number, r: ParagraphRefute): void {
    results.set(key, r);
    landed.push(key);
  }

  function startTask(key: number, text: string): void {
    const myBurst = burst;
    inFlight.set(
      key,
      (async () => {
        await slots.acquire();
        try {
          const result = await runOne(key, text, myBurst);
          if (myBurst !== burst) return; // stale burst — dropped, never written
          land(key, result);
        } finally {
          slots.release();
        }
      })(),
    );
  }

  return {
    submit(index, text) {
      textByIndex.set(index, text);
      // Decided here, ahead of the maxParagraphs routing, so a paragraph with
      // nothing to audit costs neither a call nor a slot nor a place in the
      // budget — and so a heading PAST the cap is skipped rather than
      // concatenated into the overflow batch and billed with it. Synchronous
      // bookkeeping, so it needs no burst tag: `burst` only moves in reset(),
      // which cannot interleave with this call.
      if (!hasCheckableContent(text)) return land(index, uncheckedRefute(index, text));
      if (index >= opts.maxParagraphs) overflow.push(index);
      else startTask(index, text);
    },
    reset() {
      // NOT the `slots` semaphore: a still-running old-burst task holds a real
      // slot and will call release() when it lands (the myBurst check only
      // skips WRITING its result, not its own cleanup) — resetting the count
      // here would double-count that later release() and drive it negative,
      // letting the new burst exceed `concurrency`. An old-burst task still
      // queued for a slot may get one back before a new-burst one does; it runs
      // to completion and is discarded the same way, which costs one wasted
      // call in that rare case, never a wrong result.
      burst++;
      textByIndex.clear();
      overflow.length = 0;
      inFlight.clear();
      results.clear();
      screens.clear();
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
      return keys.map((key) => {
        const r = results.get(key) ?? failedRefute(key, textByIndex.get(key) ?? "", true);
        const s = screens.get(key);
        return s && !r.screen ? { ...r, screen: s } : r;
      });
    },
  };
}
