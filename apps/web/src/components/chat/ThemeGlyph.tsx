import type { ReactNode } from "react";
import type { ThemeId } from "../../lib/theme";

// Nav colour-scheme marks, keyed by theme id (not scheme): dark and giedi are
// both scheme "dark", so a sun/moon pair couldn't tell them apart. Giedi's
// eclipse is an outlined disc with a 10-to-5 terminator (same 45° as Dark's
// crescent); the inner arc is flatter than the rim so the sliver between them
// is wide enough to fill at 15px — a tighter pair of strokes ate the fill.
const THEME_MARKS: Record<ThemeId, { glyph: string; roundJoin?: boolean; marks: ReactNode }> = {
  light: {
    glyph: "sun",
    marks: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.2M12 19.3v2.2M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2.5 12h2.2M19.3 12h2.2M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" />
      </>
    ),
  },
  giedi: {
    glyph: "eclipse",
    marks: (
      <>
        <path fill="currentColor" stroke="none" d="M5.072 8 A8 8 0 0 0 16 18.928 A22 22 0 0 1 5.072 8Z" />
        <circle cx="12" cy="12" r="8" />
        <path d="M5.072 8 A22 22 0 0 0 16 18.928" />
      </>
    ),
  },
  dark: { glyph: "moon", roundJoin: true, marks: <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5z" /> },
};

export function ThemeGlyph({ theme, size = 15 }: { theme: ThemeId; size?: number }) {
  const { glyph, roundJoin, marks } = THEME_MARKS[theme] ?? THEME_MARKS.dark;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-glyph={glyph}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin={roundJoin ? "round" : undefined}
    >
      {marks}
    </svg>
  );
}
