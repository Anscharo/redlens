/** Convert a display title to a stable HTML anchor id. */
export function toAnchorId(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
