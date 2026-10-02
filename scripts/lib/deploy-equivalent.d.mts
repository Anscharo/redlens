export interface PrAncestor {
  sha: string;
  changedSinceHead: string[];
}
export function deployEquivalentShas(head: string, ancestors: PrAncestor[]): string[];
export function ancestorsFromGit(
  head: string,
  base: string,
  limit?: number,
  git?: (args: string[]) => string[],
): PrAncestor[];
export function deployEquivalentShasFromGit(head: string, base: string | undefined): string[];
