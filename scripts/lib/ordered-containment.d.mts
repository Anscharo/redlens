export const MIN_WORDS: number;
export function words(t: string | undefined | null): string[];
export function norm(t: string | undefined | null): string;
export function wordCount(t: string | undefined | null): number;
export function wordEq(a: string, b: string): boolean;
export function orderedWordContainment(a: string | undefined | null, b: string | undefined | null): number;
export function wordsInOrder(a: string[], b: string[]): number;
export function sameDocScore(x: string | undefined | null, y: string | undefined | null): number;
export const RELOCATION_MIN_WORDS: number;
export const RELOCATION_MIN_RATIO: number;
export const RELOCATION_MIN_SIZE_MULT: number;
export function findContainer<T extends { content?: string }>(
  needle: string,
  pool: Iterable<T>,
  opts?: { minWords?: number; minRatio?: number; minSizeMult?: number },
): T | null;
export function bestByContainment<T extends { content?: string }>(
  subjectContent: string,
  candidates: Iterable<T>,
): { best: T | null; bestScore: number; margin: number };
