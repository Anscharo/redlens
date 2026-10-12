// Types for history-classify.mjs: the build scripts are plain ESM JS, but the
// preview server reads the same diff classifier through history-events.ts, so
// a branch commit and a live one are labelled lint / typo / semantic alike.

import type { DiffLine } from "../../src/lib/history.ts";

export interface PrBullet {
  title: string;
  description?: string;
}

export interface BulletMatch {
  bulletTitle: string;
  bulletDescription?: string;
  matchScore: number;
  /** How the bullet was tied to the document. */
  via: "ref" | "fuzzy" | "sole-bullet";
}

export declare function tokenize(s: unknown): string[];
export declare const DOC_NO_RE: RegExp;
export declare const UUID_RE: RegExp;
export declare const PR_LINT_RE: RegExp;
export declare const PR_TYPO_RE: RegExp;
export declare const BOILERPLATE_RE: RegExp[];
export declare function cleanDescription(s: string | null | undefined): string | null;
export declare function classifyPrTitle(prTitle: string | null | undefined): "lint" | "typo" | null;
/** "lint" | "typo" | "semantic", or null for an empty diff. */
export declare function classifyDiff(diff: DiffLine[] | null | undefined): "lint" | "typo" | "semantic" | null;
export declare function parsePrBullets(body: string | null | undefined): PrBullet[];
export declare function parentDocNo(doc_no: string): string | null;
export declare function ancestorWalkFor(docNoDepth: number): number;
export declare function nodeTokenSets(node: { doc_no: string; title?: string }, snapshotByDocNo: Map<string, { title?: string }>): { own: Set<string>; ancestors: Set<string> };
export declare function matchScore(bullet: PrBullet, ownTokens: Set<string>, ancestorTokens: Set<string>): number;
export declare function explicitRefs(bullet: PrBullet): { docNos: Set<string>; uuids: Set<string> };
export declare function nodeInRefScope(nodeDocNo: string, refDocNos: Iterable<string>): boolean;
export declare function detectAgentScope(bulletTitle: string, agentNamePrefixes: [string, string][]): string[];
export declare function matchBulletsToNodes(
  bullets: PrBullet[],
  changedNodes: { id: string; doc_no: string; title?: string }[],
  snapshot: Map<string, { doc_no: string; title?: string }>,
  opts?: { agentNamePrefixes?: [string, string][] },
): Map<string, BulletMatch>;
