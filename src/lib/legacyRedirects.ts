import { ROUTES } from "./routes";

// Exact legacy URLs that redirect straight to their replacement, no param
// interpolation needed. /reports/crossview/contents survives the removed
// Contents tab (superseded by Shape's "Doc mass by scope"); /library and
// /reports/library survive the Library → CrossView rename.
export const LEGACY_REDIRECTS: [from: string, to: string][] = [
  ["/reports/crossview/contents", ROUTES.REPORTS_CROSSVIEW],
  ["/library", ROUTES.REPORTS_CROSSVIEW],
  ["/reports/library", ROUTES.REPORTS_CROSSVIEW],
];

// Legacy URLs whose trailing :tab* segment is preserved onto the replacement
// route, e.g. /library/glossary → /reports/crossview/glossary. Bare
// "/library" (no trailing segment) doesn't match "/library/:tab*" in wouter
// — the pattern requires the literal slash — so each needs its own exact
// route in LEGACY_REDIRECTS above alongside the wildcard one here.
export const LEGACY_REDIRECT_PREFIXES: string[] = ["/library/:tab*", "/reports/library/:tab*"];
