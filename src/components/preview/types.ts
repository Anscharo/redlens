// Shared type-only definitions for the /preview views. Colocated here (rather
// than declared in PreviewHome.tsx) so PreviewHome and PreviewPrTabs don't form
// a type-only import cycle between each other.
export interface Entry {
  id: string;
  title?: string;
  detail: string;
  at: number;
}
