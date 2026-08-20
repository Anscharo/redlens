// Sticky header height in CSS pixels. Anchor targets and sticky sidebars
// offset by this so hash navigation and scroll-into-view don't land behind
// the header. Keep in sync with the SearchBar's actual rendered height
// (`px-4 pt-3 pb-2` + a single-row flex of ~28-30px icons ≈ 64px).
export const HEADER_OFFSET = 64;
