// Fits a MatchAside's entries into its row's height budget using
// @chenglou/pretext text measurement — the floaters are absolutely positioned
// beside their row, so without this a tall aside would overflow into (and
// overlap) the next row's aside. Pretext predicts the wrapped line count at
// the gutter width without DOM reflow; entries that don't fit are trimmed to
// the lines that do (ellipsized) or dropped.

import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext";
import type { HiddenMatch } from "@/lib/reportFilter";

// Must mirror .match-aside in index.css.
export const ASIDE_FONT = '10px "Source Code Pro", "Courier New", monospace';
export const ASIDE_LINE_HEIGHT = 14; // 10px × 1.4
// .match-aside top offset (0.45rem) + padding-bottom — space the aside can't use.
const CHROME_PX = 10;

export function fitAsideMatches(
  matches: HiddenMatch[],
  widthPx: number,
  rowHeightPx: number,
): HiddenMatch[] {
  let budget = Math.floor((rowHeightPx - CHROME_PX) / ASIDE_LINE_HEIGHT);
  const out: HiddenMatch[] = [];
  for (const m of matches) {
    if (budget < 1) break;
    // Measured as the label + excerpt flowing inline, matching the rendered
    // markup. The label's letter-spacing is not modeled — the ellipsis trim
    // below under-fills by design, so the error can't push a line over.
    const text = `${m.label.toUpperCase()} ${m.excerpt}`;
    const prepared = prepareWithSegments(text, ASIDE_FONT);
    const { lines } = layoutWithLines(prepared, widthPx, ASIDE_LINE_HEIGHT);
    if (lines.length <= budget) {
      out.push(m);
      budget -= lines.length;
      continue;
    }
    // Keep only the lines that fit; re-derive the excerpt by stripping the
    // measured label prefix and ellipsizing.
    const kept = lines
      .slice(0, budget)
      .map((l) => l.text)
      .join(" ")
      .slice(m.label.length)
      .trimStart()
      // Leave room for the appended ellipsis so the last line can't rewrap.
      .replace(/\S{1,2}$/, "");
    out.push({ ...m, excerpt: `${kept.replace(/[\s…]+$/, "")}…` });
    budget = 0;
  }
  return out;
}
