/**
 * How many levels a shift-click on a sidebar chevron unfolds.
 *
 * Its own module, not treeUtils: that one pulls in text measurement (canvas), so
 * every test touching the tree mocks it, and a constant living there would have
 * to be re-declared in each of those mocks.
 *
 * Shared because the footer hint says the number out loud ("expand 3 levels",
 * hintText.ts) while TreeSidebar's cascade enforces it. As two literals they
 * could drift with nothing to catch it.
 */
export const CASCADE_LEVELS = 3;
