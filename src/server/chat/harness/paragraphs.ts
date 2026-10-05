// Per-paragraph deterministic checks (and refuter) as the answer streams
// (docs/chat-system.md §6); the full-text pass after `done` stays the authority.
import type { Indexes } from "../../retrieval/indexes.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import { isExternalMscTool } from "../../external/envelope.ts";
import { isAtlasText, classifyToolSource, type EvidenceEntry } from "../verify/verifier.ts";
import type { ParagraphRefute, ParagraphRefuter } from "../verify/paragraph-refute.ts";
import { createParagraphStream, type ParagraphCheck, type ParagraphEvidence, type ParagraphStream } from "../verify/incremental.ts";
import type { GateEvidence } from "./link-gate.ts";
import type { HarnessEvent } from "./types.ts";

// `evidence` is a getter, not a snapshot: it reads the gate evidence live, so
// a paragraph is checked against whatever has been retrieved by the time IT
// closes. History tool texts count as atlas evidence here, same as
// splitFromTranscript classifies them.
export function paragraphEvidenceFrom(historyEntries: EvidenceEntry[], gate: GateEvidence): () => ParagraphEvidence {
  const historyAtlasTexts = historyEntries.filter((e) => isAtlasText(e.sourceClass)).map((e) => e.content);
  return () => ({
    atlasTexts: [
      ...historyAtlasTexts,
      // Same allowlist as splitFromTranscript, reached by NAME here because
      // gate results carry no sourceClass — classifyToolSource is the single
      // rule both spellings go through, so they cannot drift apart.
      ...gate.results.filter((r) => isAtlasText(classifyToolSource(r.name))).map((r) => r.content),
    ],
    externalTexts: gate.results.filter((r) => isExternalMscTool(r.name)).map((r) => r.content),
    allTexts: gate.texts,
  });
}

const refuteEvent = (r: ParagraphRefute): HarnessEvent =>
  ({ type: "paragraph_refute", index: r.index, parsed: r.parsed, candidates: r.contradictions.length });

interface TrackerOpts {
  ix: Indexes;
  question: string;
  evidence: () => ParagraphEvidence;
  refuter: ParagraphRefuter | null;
  obs?: ErrorContext;
}

export class ParagraphTracker {
  // Tallied for the round_checks row, reset alongside the paragraph stream —
  // this describes the FINAL burst (the shipped answer), not every draft the
  // turn ever streamed and set aside.
  readonly counts = { paragraphs: 0, flagged: 0 };
  private readonly paragraphs: ParagraphStream;
  // Indices already reported via a mid-stream `paragraph_refute` event this
  // burst — `settle()` returns the WHOLE burst, so this is what keeps the
  // post-loop flush from re-yielding one the reader already saw.
  private readonly reported = new Set<number>();

  private readonly opts: TrackerOpts;

  constructor(opts: TrackerOpts) {
    this.opts = opts;
    this.paragraphs = createParagraphStream({ ix: opts.ix, question: opts.question, evidence: opts.evidence });
  }

  /** The buffered draft is being set aside; a stale burst's refutes are dropped when they land. */
  reset(): void {
    this.paragraphs.reset();
    this.counts.paragraphs = 0;
    this.counts.flagged = 0;
    this.reported.clear();
    this.opts.refuter?.reset();
  }

  private *record(pc: ParagraphCheck): Generator<HarnessEvent> {
    this.counts.paragraphs++;
    if (pc.findings.length > 0) this.counts.flagged++;
    yield { type: "paragraph_check", ...pc };
    this.opts.refuter?.submit(pc.index, pc.text);
  }

  // An incremental-check failure must never break a turn — the full-text
  // pass after `done` is still the authority.
  *push(text: string): Generator<HarnessEvent> {
    try {
      for (const pc of this.paragraphs.push(text)) yield* this.record(pc);
    } catch (err) {
      captureError(err, this.opts.obs, { stage: "incremental_checks" });
    }
  }

  /** The trailing paragraph at generation end — same failure rule as push. */
  *flushTail(): Generator<HarnessEvent> {
    try {
      const tail = this.paragraphs.flush();
      if (tail) yield* this.record(tail);
    } catch (err) {
      captureError(err, this.opts.obs, { stage: "incremental_checks" });
    }
  }

  *drain(): Generator<HarnessEvent> {
    if (!this.opts.refuter) return;
    for (const r of this.opts.refuter.drain()) {
      this.reported.add(r.index);
      yield refuteEvent(r);
    }
  }

  // Collect whatever the per-paragraph refuter produced during streaming —
  // most of it should already be landed by now — then report anything not
  // already surfaced via a mid-stream `paragraph_refute`.
  async *settle(timeoutMs: number): AsyncGenerator<HarnessEvent, { paragraphRefutes?: ParagraphRefute[]; settleMs?: number }> {
    if (!this.opts.refuter) return {};
    const settleStart = Date.now();
    const paragraphRefutes = await this.opts.refuter.settle(timeoutMs);
    const settleMs = Date.now() - settleStart;
    for (const r of paragraphRefutes) {
      if (this.reported.has(r.index)) continue;
      this.reported.add(r.index);
      yield refuteEvent(r);
    }
    return { paragraphRefutes, settleMs };
  }
}
