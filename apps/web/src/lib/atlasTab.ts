// The reader's right-panel sections, in pill-bar order. History is first and the
// default: it rides the URL as an absent ?view= param, on the live reader and in
// previews alike. A section with nothing to show is hidden (history always shows),
// so the panel falls back to the first shown one.
export const ATLAS_TABS = ["history", "notes", "onchain", "glossary"] as const;
export type AtlasTab = (typeof ATLAS_TABS)[number];
export const DEFAULT_ATLAS_TAB: AtlasTab = "history";
