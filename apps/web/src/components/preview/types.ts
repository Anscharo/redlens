// Shared type-only definitions for the /preview views. Colocated here (rather
// than declared in PreviewHome.tsx) so PreviewHome and PreviewPrTabs don't form
// a type-only import cycle between each other.
export interface Entry {
  id: string;
  title?: string;
  detail: string;
  at: number;
  /** The preview is of a private repo, so `id` names a private owner/repo and
   *  must not leave the browser in analytics. See PreviewPrTabs's click handler. */
  private?: boolean;
}
