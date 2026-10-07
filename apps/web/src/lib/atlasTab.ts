// The reader's right-panel sections, in pill-bar order. "notes" is the default
// and rides the URL as an absent ?view= param.
export const ATLAS_TABS = ["notes", "glossary", "history"] as const;
export type AtlasTab = (typeof ATLAS_TABS)[number];
