export const PROTECTED_ENVIRONMENTS: readonly string[];

export interface PruneCandidate {
  name: string;
  pr: number;
}

export interface PruneArgs {
  apply: boolean;
  orphans: boolean;
  onlyPr: number | undefined;
  keeps: string[];
  repo: string | undefined;
}

export function isProtected(name: string, extraKeeps?: string[]): boolean;
export function parsePruneArgs(argv: string[]): PruneArgs;
export function selectCandidates(
  environments: { name: string }[],
  opts?: { onlyPr?: number; keeps?: string[] },
): { candidates: PruneCandidate[]; keptCount: number };
export function looksLikeMissingPrScope(
  candidates: PruneCandidate[],
  states: Map<number, string>,
): boolean;
export function planPrune(
  candidates: PruneCandidate[],
  states: Map<number, string>,
  opts?: { orphans?: boolean },
): {
  open: PruneCandidate[];
  stale: PruneCandidate[];
  unknown: PruneCandidate[];
  doomed: PruneCandidate[];
};
