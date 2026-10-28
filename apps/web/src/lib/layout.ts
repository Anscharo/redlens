// Sticky header height in CSS pixels. Anchor targets and sticky sidebars
// offset by this so hash navigation and scroll-into-view don't land behind
// the header. Keep in sync with AppHeader's rendered height from `sm` up
// (`pt-3 pb-2` around one row of ~28-30px controls ≈ 64px). Below `sm` the
// search wraps to a second row, so the header is taller than this offset.
export const HEADER_OFFSET = 64;
