// Merges one burst's per-paragraph refute results (paragraph-refute.ts) into
// the shape sliced-verifier.ts's refute backbone needs: the union of every
// paragraph's candidates/notFound, plus the burst stats that land on
// `Verdict.paragraphs` for calibration. Split out of sliced-verifier.ts so
// that file's paragraph-mode branch stays a few lines.
import type { Contradiction } from "./verifier.ts";
import type { ParagraphRefute } from "./paragraph-refute.ts";

export interface ParagraphBackbone {
  candidates: Contradiction[];
  notFound: string[];
  discardedTotal: number;
  parsed: boolean; // every submitted paragraph parsed — a single timeout/unparsed flips this false
  notes: string;
  usage: { input: number; output: number }[];
  paragraphs: { count: number; parsed: number; candidates: number; discarded: number; timedOut: number };
}

export function mergeParagraphRefutes(refutes: ParagraphRefute[]): ParagraphBackbone {
  const candidates = refutes.flatMap((r) => r.contradictions);
  const notFound = [...new Set(refutes.flatMap((r) => r.notFound))].slice(0, 5);
  const discardedTotal = refutes.reduce((s, r) => s + r.discarded, 0);
  const parsedCount = refutes.filter((r) => r.parsed).length;
  const timedOutCount = refutes.filter((r) => r.timedOut).length;
  const usage = refutes.map((r) => r.usage).filter((u): u is { input: number; output: number } => u !== null);
  return {
    candidates,
    notFound,
    discardedTotal,
    parsed: refutes.length > 0 && parsedCount === refutes.length,
    notes: `${parsedCount} paragraph(s) refuted, ${refutes.length - parsedCount} unparsed`,
    usage,
    paragraphs: { count: refutes.length, parsed: parsedCount, candidates: candidates.length, discarded: discardedTotal, timedOut: timedOutCount },
  };
}
