// Shared type-only definitions for the /preview views. Colocated here (rather
// than declared in PreviewHome.tsx) so PreviewHome and PreviewPrTabs don't form
// a type-only import cycle between each other.
export interface Entry {
  id: string;
  title?: string;
  detail: string;
  at: number;
  /** The PR this preview is of, shown as `#N` in the first column exactly like
   *  the open-PRs tab. Absent for a branch or bare-commit preview, which falls
   *  back to the id — the only label those have. */
  prNumber?: number | null;
  /** owner/name of the repo the preview was built from. A fork's own PR numbers
   *  are repo-local, so the number alone doesn't say where it lives. */
  repo?: string;
  /** The branch (or pull-N) the preview was built from — what a PR-less row shows
   *  in the first column, since its id would just repeat the repo column. */
  ref?: string;
  /** The preview is of a private repo, so `id` names a private owner/repo and
   *  must not leave the browser in analytics. See PreviewPrTabs's click handler. */
  private?: boolean;
}
