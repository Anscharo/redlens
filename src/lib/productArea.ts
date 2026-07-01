// Maps a route path to the "product" surface it belongs to, so every analytics
// event can be sliced by product: reader, search, radar, reports, preview, chat,
// other. Registered as a super property on each navigation (see usePageAnalytics).
// `chat` is a widget overlay (not a route) so chat events set product explicitly.
export type Product =
  | "reader"
  | "search"
  | "radar"
  | "reports"
  | "preview"
  | "chat"
  | "other";

export function productForPath(path: string): Product {
  if (path.startsWith("/atlas")) return "reader";
  if (path.startsWith("/radar") || path.startsWith("/constellations")) return "radar";
  if (path.startsWith("/reports")) return "reports";
  if (path.startsWith("/preview")) return "preview";
  if (path === "/" || path.startsWith("/search-hints")) return "search";
  return "other"; // /provenance, /admin, etc.
}
