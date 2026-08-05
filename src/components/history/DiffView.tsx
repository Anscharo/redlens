import { useMemo } from "react";
import type { DiffLine, WordSegment } from "../../lib/history";
import { refineProseDiff } from "../../lib/diffProse";
import { isStructuredLine } from "../../lib/diffSentences";
import { fencedFlags } from "../../lib/diffFences";
import { IntralineDiff } from "./IntralineDiff";

const DIFF_LINE_BG: Record<string, string> = {
  "+": "var(--diff-added-bg)",
  "-": "var(--diff-removed-bg)",
  "=": "transparent",
};
const DIFF_LINE_COLOR: Record<string, string> = {
  "+": "var(--diff-added-fg)",
  "-": "var(--diff-removed-fg)",
  "=": "var(--tan-3)",
};
const DIFF_LINE_PREFIX: Record<string, string> = { "+": "+", "-": "−", "=": " " };

// The marker column is its own gutter — darker than the diff box, ruled off from
// the text — so +/−/Δ read as chrome rather than as part of the changed line. The
// column itself is painted as a background gradient on the box (below) so it runs
// unbroken through the box's own padding; the rows only place the glyph in it.
const GUTTER_W = 20; // px
const GUTTER_CLASS = "shrink-0 select-none text-center mono py-1";
const GUTTER_STYLE: React.CSSProperties = { width: GUTTER_W };
const DIFF_BOX_BG = `linear-gradient(to right, var(--bg-deep) 0 ${GUTTER_W}px, var(--border) ${GUTTER_W}px ${GUTTER_W + 1}px, var(--surface) ${GUTTER_W + 1}px)`;

/** Wrapping + typeface for one line body. Prose falls through to the body sans
 *  (Inter) and breaks at word boundaries; a structured line — frontmatter
 *  `key: value`, table row, heading, code — stays monospace and may break
 *  mid-token so long hashes and addresses still fit. Uses the same classifier
 *  as the prose-diff refinement, so a line's font agrees with how its diff was
 *  computed. `inFence` overrides it: inside a ``` block every line is code,
 *  however word-like it looks on its own (see ../../lib/diffFences). */
const STRUCTURED_CLASS = "mono whitespace-pre-wrap break-all";
const PROSE_CLASS = "whitespace-pre-wrap break-words";

function lineClass(text: string, inFence: boolean): string {
  return inFence || isStructuredLine(text) ? STRUCTURED_CLASS : PROSE_CLASS;
}

/** Same test for an intraline row: reconstruct both sides of the line (the
 *  segments interleave them) and treat it as structured if either side is. */
function segmentsClass(segments: WordSegment[], inFence: boolean): string {
  const side = (keep: string) =>
    segments.filter(([op]) => op === "=" || op === keep).map(([, t]) => t).join("");
  return inFence || isStructuredLine(side("-")) || isStructuredLine(side("+"))
    ? STRUCTURED_CLASS
    : PROSE_CLASS;
}

export function DiffView({ lines }: { lines: DiffLine[] }) {
  // Hooks must run unconditionally — refineProseDiff itself tolerates
  // non-array input (returns []), so this stays safe ahead of the guard below.
  const refined = useMemo(() => refineProseDiff(lines), [lines]);
  // Which rows sit inside a ``` block — a per-line classifier can't see that.
  const fenced = useMemo(() => fencedFlags(refined), [refined]);
  // Defensive: a malformed payload (e.g. a legacy double-encoded jsonb diff
  // that arrives as a string) must degrade, not crash the whole history tab.
  if (!Array.isArray(lines)) return null;
  return (
    <div
      className="mt-2 py-2 rounded overflow-x-auto text-[13px] leading-[1.6]"
      style={{ background: DIFF_BOX_BG, border: "1px solid var(--border)" }}
    >
      {refined.map((line, i) => {
        const op = line[0];

        if (op === "…") {
          return (
            <div key={i} className="flex">
              <span className={GUTTER_CLASS} style={{ ...GUTTER_STYLE, color: "var(--tan-3)" }}>
                ⋯
              </span>
              <span className="py-1">&nbsp;</span>
            </div>
          );
        }

        // The +/−/Δ marker sits in the gutter, OUTSIDE the tinted box that bounds
        // the changed excerpt, so it doesn't read as itself being edited text.
        // Δ (not ~) for a modified line: at this size a tilde reads as a dash.
        if (op === "~") {
          const segments = line[1] as WordSegment[];
          return (
            <div key={i} className="flex">
              <span className={GUTTER_CLASS} style={{ ...GUTTER_STYLE, color: "var(--tan-3)" }}>
                Δ
              </span>
              <span className="min-w-0 px-2 py-1">
                <span
                  className="rounded px-1"
                  style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
                >
                  <IntralineDiff segments={segments} className={segmentsClass(segments, fenced[i])} />
                </span>
              </span>
            </div>
          );
        }

        const text = line[1] as string;
        // An added/removed line is marked up as such; context lines are plain.
        const Body = op === "+" ? "ins" : op === "-" ? "del" : "span";
        return (
          <div key={i} className="flex">
            <span className={GUTTER_CLASS} style={{ ...GUTTER_STYLE, color: DIFF_LINE_COLOR[op] }}>
              {DIFF_LINE_PREFIX[op]}
            </span>
            <span className="min-w-0 px-2 py-1">
              <Body
                className={`${lineClass(text, fenced[i])} no-underline${op === "=" ? "" : " rounded px-1"}`}
                style={{
                  background: DIFF_LINE_BG[op],
                  color: op === "=" ? "var(--tan-2)" : DIFF_LINE_COLOR[op],
                }}
              >
                {text || "\u00a0"}
              </Body>
            </span>
          </div>
        );
      })}
    </div>
  );
}
