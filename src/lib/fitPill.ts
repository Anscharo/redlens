import { prepareWithSegments, measureNaturalWidth, measureLineStats } from "@chenglou/pretext";

export const PILL_MAX_PX = 10;
export const PILL_MIN_PX = 8;

// Mirrors .atlas-type-pill: weight 600, Source Code Pro, letter-spacing 0.06em.
const PILL_WEIGHT = 600;
const LETTER_SPACING_EM = 0.06;
const pillFont = (px: number) => `${PILL_WEIGHT} ${px}px "Source Code Pro", monospace`;
// letter-spacing isn't part of the CSS font shorthand pretext measures, so add it.
const tracking = (px: number, chars: number) => LETTER_SPACING_EM * px * chars;

export interface PillFit {
  fontSize: number;
  /** Content-box width hugging the longest (possibly wrapped) line, in px. */
  textWidth: number;
}

/**
 * Scale the type-pill font to fit `budget` (content px) and report the width of
 * the longest rendered line — so a wrapped pill hugs its longest line instead of
 * filling the gutter. Measured with @chenglou/pretext (the app's text-measure
 * lib); falls back to a character estimate where canvas is unavailable (jsdom).
 */
export function fitPill(rawText: string, budget: number): PillFit {
  const text = rawText.toUpperCase();
  const chars = [...text].length;
  if (budget <= 0) return { fontSize: PILL_MAX_PX, textWidth: 0 };

  try {
    const oneLine =
      measureNaturalWidth(prepareWithSegments(text, pillFont(PILL_MAX_PX))) +
      tracking(PILL_MAX_PX, chars);

    let fontSize = PILL_MAX_PX;
    if (oneLine > budget) {
      const scaled = (PILL_MAX_PX * budget) / oneLine;
      fontSize = Math.max(PILL_MIN_PX, Math.min(PILL_MAX_PX, Math.round(scaled * 10) / 10));
    }

    const prep = prepareWithSegments(text, pillFont(fontSize));
    const natural = measureNaturalWidth(prep);
    const naturalLS = natural + tracking(fontSize, chars);
    if (naturalLS <= budget) {
      return { fontSize, textWidth: Math.min(Math.ceil(naturalLS) + 1, budget) };
    }

    // Wrapped. pretext wraps on glyph-only widths, but the browser wraps tighter
    // because of letter-spacing — so hand pretext a budget shrunk by tracking's
    // proportional share, else it fits more per line and reports a full-width box.
    const effBudget = (budget * natural) / naturalLS;
    const { maxLineWidth } = measureLineStats(prep, effBudget);
    const avgChar = chars > 0 ? natural / chars : 0;
    const lineChars = avgChar > 0 ? Math.round(maxLineWidth / avgChar) : 0;
    const width = maxLineWidth + tracking(fontSize, lineChars);
    return { fontSize, textWidth: Math.min(Math.ceil(width) + 1, budget) };
  } catch {
    // No canvas (jsdom/SSR): rough monospace estimate, never throws into render.
    const est = chars * PILL_MAX_PX * 0.62;
    return { fontSize: PILL_MAX_PX, textWidth: Math.min(Math.ceil(est), budget) };
  }
}
