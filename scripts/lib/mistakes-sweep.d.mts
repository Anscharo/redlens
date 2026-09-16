// Type declarations for the incremental Potential Mistakes sweep logic
// (mistakes-sweep.mjs), so the assertion test can import it under
// tsconfig.test.json. Runtime stays mistakes-sweep.mjs.

/** The fields of an atlas node the sweep reads. `contentHash` covers the body
 *  only, which is why the digest folds in title and type separately. */
export interface MistakeSweepNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  content: string;
  contentHash: string;
  /** Source .md the document lives in. Attached by the CLI, not the loader. */
  file?: string;
}

/** A row in public/potential-mistakes.json. */
export interface Mistake {
  id: string;
  docNo: string;
  /** null on a corpus-wide finding, which spans documents and belongs to none. */
  uuid: string | null;
  file: string;
  category: string;
  severity: string;
  pass: string;
  quote: string;
  issue: string;
  fix: string;
}

/** uuid → digest of what was last evaluated for that document. */
export interface SweepState {
  version: number;
  atlasSha: string | null;
  sweptAt: string | null;
  docs: Record<string, string>;
}

export interface SweepPlan {
  new: string[];
  changed: string[];
  /** Unchanged documents re-queued because they cross-reference a moved one. */
  linked: string[];
  unchanged: string[];
  removed: string[];
  /** citer uuid → the moved/removed uuids it cross-references. */
  linkedBecause: Record<string, string[]>;
  total: number;
}

export type ValidationResult =
  | { ok: true; finding: Mistake }
  | { ok: false; reason: string };

export const STATE_VERSION: number;
export const CATEGORIES: Set<string>;
export function docDigest(node: MistakeSweepNode): string;
export function emptyState(): SweepState;
export function isStateUsable(state: unknown): boolean;
/** target uuid → uuids of the documents whose text links to it. */
export function buildBacklinks(nodes: MistakeSweepNode[]): Map<string, Set<string>>;
export function planSweep(
  nodes: MistakeSweepNode[],
  state: SweepState | null,
  opts?: { full?: boolean; backlinks?: Map<string, Set<string>> | null },
): SweepPlan;
export function docsToEvaluate(plan: SweepPlan): string[];
export function chunkDocs(
  nodes: MistakeSweepNode[],
  opts?: { maxBytes?: number },
): MistakeSweepNode[][];
export function validateFinding(
  row: unknown,
  nodeMap: Record<string, MistakeSweepNode>,
): ValidationResult;
export function dedupeIds(findings: Mistake[]): Mistake[];
export function suppressRejected(
  incoming: Mistake[],
  rejected?: Mistake[],
): { findings: Mistake[]; suppressed: number };
export function mergeFindings(
  previous: Mistake[],
  incoming: Mistake[],
  evaluated: Set<string> | string[],
  removed?: string[],
  opts?: { dropCorpus?: boolean },
): { findings: Mistake[]; kept: number; replaced: number; added: number };
export function sortFindings(findings: Mistake[]): Mistake[];
export function compareDocNo(a: string, b: string): number;
export function advanceState(
  state: SweepState | null,
  nodeMap: Record<string, MistakeSweepNode>,
  evaluated: string[],
  removed?: string[],
  atlasSha?: string | null,
): SweepState;
