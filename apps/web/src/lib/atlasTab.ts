// The reader's right-panel sections, in pill-bar order. "notes" is the default
// and rides the URL as an absent ?view= param. A section with nothing to show
// is hidden (history always shows), so the panel falls back to the first shown one.
export const ATLAS_TABS = ["notes", "onchain", "history", "glossary"] as const;
export type AtlasTab = (typeof ATLAS_TABS)[number];
