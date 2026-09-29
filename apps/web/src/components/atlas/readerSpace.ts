/** The document column stays at least this wide. Sidebars give up space first. */
export const READER_MIN_PX = 400;

/** How narrow the notes panel may get. Below this it hides rather than
 *  squeezing the document under READER_MIN_PX. Lower than the old 260px drag
 *  floor so the panel can collapse further before it disappears. */
export const RIGHT_PANEL_MIN = 200;

export const RIGHT_PANEL_MAX = 800;
export const RIGHT_PANEL_DEFAULT = 520;

/** Existing hide breakpoint. Applied to the width beside the docked chat,
 *  not the raw window, so a wide chat collapses the panel sooner. */
export const RIGHT_PANEL_BREAKPOINT = 750;

export function rightPanelLayout({
  preferred,
  rowWidth,
  hideForBreakpoint,
}: {
  preferred: number;
  /** Reader + notes row. 0 until it has been measured. */
  rowWidth: number;
  hideForBreakpoint: boolean;
}): { hidden: boolean; width: number } {
  if (hideForBreakpoint) return { hidden: true, width: preferred };
  if (rowWidth <= 0) return { hidden: false, width: preferred };
  const room = rowWidth - READER_MIN_PX;
  if (room < RIGHT_PANEL_MIN) return { hidden: true, width: preferred };
  return { hidden: false, width: Math.min(preferred, Math.round(room)) };
}
