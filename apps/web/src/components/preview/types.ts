// Shared type-only definitions for the /preview views, colocated so PreviewHome
// and PreviewPrTabs don't import types from each other.
export interface Entry {
  id: string;
  title?: string;
  detail: string;
  at: number;
  prNumber?: number | null;
  /** owner/name — a fork's PR numbers are repo-local, so `#N` alone is ambiguous. */
  repo?: string;
  /** Branch or pull-N. Leads the row when there is no PR number. */
  ref?: string;
  /** Private repo: `id` names it, so keep the id out of analytics. */
  private?: boolean;
}
