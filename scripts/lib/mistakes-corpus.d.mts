// Type declarations for the corpus-wide detectors (mistakes-corpus.mjs), so the
// test can import them under tsconfig.test.json. Runtime stays the .mjs.

import type { Mistake, MistakeSweepNode } from "./mistakes-sweep.d.mts";

/** A corpus finding, which belongs to no single document and so carries no
 *  uuid. `detector` names what produced it, and therefore what can rebuild it. */
export interface CorpusMistake extends Mistake {
  uuid: null;
  detector: string;
}

export function slotKey(docNo: string): { slot: string; root: string } | null;
export function normalizeForCompare(
  text: string,
  artifactName: string,
  /** Resolves a UUID to its doc_no. The load-bearing argument: without it a
   *  UUID cannot be placed in the slot space and falls back to <uuid>. */
  docNoOf?: (uuid: string) => string | undefined,
): string;
export function uniqueWords(a: string, b: string): string[];
export function wordDistance(a: string, b: string): number;
export function templateDivergence(nodes: MistakeSweepNode[]): CorpusMistake[];
export const CORPUS_DETECTORS: Record<string, (nodes: MistakeSweepNode[]) => CorpusMistake[]>;
export function runCorpusDetectors(nodes: MistakeSweepNode[]): CorpusMistake[];
