// Type declarations for the placement-aware document briefings logic
// (doc-briefings.mjs), so its test can import it under tsconfig.test.json.
// Runtime stays doc-briefings.mjs.
import type { MistakeSweepNode, SweepPlan, SweepState } from "./mistakes-sweep.d.mts";

/** The fields of an atlas node the briefings read — the same ones the sweep does. */
export type BriefingNode = MistakeSweepNode;

/** Every child of one doc-number parent. `parent` is the nearest ancestor that
 *  exists as a document, or null. */
export interface SiblingSet {
  key: string;
  parent: BriefingNode | null;
  members: BriefingNode[];
}

export interface BriefingTree {
  byDocNo: Map<string, BriefingNode>;
  sets: SiblingSet[];
  setOf: Map<string, SiblingSet>;
  ancestorsOf(node: BriefingNode): BriefingNode[];
  childrenOf: Map<string, BriefingNode[]>;
}

export interface Citation {
  from: BriefingNode;
  line: string;
}

/** One rendered sibling set; `docs` are the UUIDs that owe a row. */
export interface RenderedSet {
  set: SiblingSet | null;
  text: string;
  docs: string[];
}

/** What the model may supply. */
export interface BriefingEntry {
  briefing: string;
  questions: string[];
}

/** A row in public/doc-briefings.json: the entry plus what the merge stamps. */
export interface BriefingRow extends BriefingEntry {
  digest: string;
  model: string | null;
}

export type BriefingValidation =
  | { ok: true; uuid: string; entry: BriefingEntry; reason?: undefined }
  | { ok: false; reason: string; uuid?: undefined; entry?: undefined };

export const ARTIFACT_VERSION: number;
export const BRIEFING_MIN: number;
export const BRIEFING_MAX: number;
export const AGENT_INSTRUCTIONS: string;
export const BRIEFING_REPLY_INSTRUCTIONS: string;
export const BRIEFING_MAX_FAILURES: number;

export function parentKey(docNo: string): string;
export function unlink(text: string): string;
export function buildTree(nodes: BriefingNode[]): BriefingTree;
export function buildCitations(nodes: BriefingNode[]): Map<string, Citation[]>;
export function buildDependents(nodes: BriefingNode[], tree?: BriefingTree): Map<string, Set<string>>;
export function planBriefings(
  nodes: BriefingNode[],
  state: (SweepState & { complete?: boolean }) | null,
  opts?: { full?: boolean; tree?: BriefingTree },
): SweepPlan;
export function spreadSample(ids: string[], count: number, block?: number): string[];
export function isComplete(nodes: BriefingNode[], state: SweepState | null): boolean;
export function renderSet(
  set: SiblingSet,
  ctx: { tree: BriefingTree; citations: Map<string, Citation[]>; write: Set<string> },
): string;
export function renderQueue(
  nodes: BriefingNode[],
  queued: Iterable<string>,
  ctx?: { tree?: BriefingTree; citations?: Map<string, Citation[]> },
): RenderedSet[];
export function packSets(
  rendered: RenderedSet[],
  opts?: { maxBytes?: number; maxRows?: number },
): { texts: string[]; docs: string[] }[];
export function parseRows(text: string): unknown[] | null;
export function validateBriefing(
  row: unknown,
  nodeMap: Record<string, BriefingNode>,
  requested?: Set<string> | null,
): BriefingValidation;
export function mergeBriefings(
  previous: Record<string, BriefingRow>,
  incoming: { uuid: string; entry: BriefingEntry }[],
  nodeMap: Record<string, BriefingNode>,
  removed?: string[],
  model?: string | null,
): { briefings: Record<string, BriefingRow>; added: number; replaced: number; kept: number };

/** What a stored row needs for the seed and queue rules. */
export interface StoredBriefing {
  briefing: string;
  digest: string;
  context_digest: string;
  failures: number;
  failed_context: string | null;
}

export function briefingEmbedText(row: { briefing: string; questions?: string[] | null }): string;
export function contextDigest(
  node: BriefingNode,
  tree: BriefingTree,
  citations: Map<string, Citation[]>,
): string;
export function seedAction(
  have: Pick<StoredBriefing, "briefing" | "digest"> | undefined,
  seed: { digest: string },
  liveDigest: string | undefined,
): "insert" | "replace" | "keep" | "skip";
export function briefingQueue(
  docs: BriefingNode[],
  rows: Map<string, Pick<StoredBriefing, "briefing" | "context_digest" | "failures" | "failed_context">>,
  cap: number,
  ctx?: { tree?: BriefingTree; citations?: Map<string, Citation[]> },
): string[];

export function serializeArtifact(briefings: Record<string, BriefingRow>, atlasSha: string | null): string;
export function briefingTextDiffers(
  a: { briefing: string; questions?: string[] | null } | undefined,
  b: { briefing: string; questions?: string[] | null } | undefined,
): boolean;
export function pullBriefings(
  rows: {
    doc_id: string;
    briefing: string;
    questions: string[];
    digest: string;
    model: string | null;
  }[],
): Record<string, BriefingRow>;
export function countDiffering(
  file: Record<string, { briefing: string; questions?: string[] | null }>,
  pulled: Record<string, { briefing: string; questions?: string[] | null }>,
): number;
