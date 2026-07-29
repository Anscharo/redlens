import { useMemo } from "react";
import type { DiffLine, WordSegment } from "../../lib/history";
import { refineProseDiff } from "../../lib/diffProse";

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
// the text — so +/−/~ read as chrome rather than as part of the changed line. The
// column itself is painted as a background gradient on the box (below) so it runs
// unbroken through the box's own padding; the rows only place the glyph in it.
const GUTTER_W = 20; // px
const GUTTER_CLASS = "shrink-0 select-none text-center py-0.5";
const GUTTER_STYLE: React.CSSProperties = { width: GUTTER_W };
const DIFF_BOX_BG = `linear-gradient(to right, var(--bg-deep) 0 ${GUTTER_W}px, var(--border) ${GUTTER_W}px ${GUTTER_W + 1}px, var(--surface) ${GUTTER_W + 1}px)`;

const WORD_ADDED_STYLE: React.CSSProperties = {
  background: "var(--diff-added-bg)",
  color: "var(--diff-added-fg)",
  borderRadius: 2,
};
const WORD_REMOVED_STYLE: React.CSSProperties = {
  background: "var(--diff-removed-bg)",
  color: "var(--diff-removed-fg)",
  borderRadius: 2,
  textDecoration: "line-through",
};

function IntralineDiff({ segments }: { segments: WordSegment[] }) {
  return (
    <span className="whitespace-pre-wrap break-all">
      {segments.map((seg, i) => {
        const [op, text] = seg;
        if (op === "+")
          return (
            <ins key={i} className="no-underline" style={WORD_ADDED_STYLE}>
              {text}
            </ins>
          );
        if (op === "-")
          return (
            <del key={i} style={WORD_REMOVED_STYLE}>
              {text}
            </del>
          );
        return (
          <span key={i} style={{ color: "var(--tan-2)" }}>
            {text}
          </span>
        );
      })}
    </span>
  );
}

export function DiffView({ lines }: { lines: DiffLine[] }) {
  // Hooks must run unconditionally — refineProseDiff itself tolerates
  // non-array input (returns []), so this stays safe ahead of the guard below.
  const refined = useMemo(() => refineProseDiff(lines), [lines]);
  // Defensive: a malformed payload (e.g. a legacy double-encoded jsonb diff
  // that arrives as a string) must degrade, not crash the whole history tab.
  if (!Array.isArray(lines)) return null;
  return (
    <div
      className="mt-2 py-2 rounded overflow-x-auto mono text-[12px] leading-relaxed"
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
              <span className="py-0.5">&nbsp;</span>
            </div>
          );
        }

        // The +/-/~ marker sits in the gutter, OUTSIDE the tinted box that bounds
        // the changed excerpt, so it doesn't read as itself being edited text.
        if (op === "~") {
          const segments = line[1] as WordSegment[];
          return (
            <div key={i} className="flex">
              <span className={GUTTER_CLASS} style={{ ...GUTTER_STYLE, color: "var(--tan-3)" }}>
                ~
              </span>
              <span className="min-w-0 px-2 py-0.5">
                <span
                  className="rounded px-1"
                  style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
                >
                  <IntralineDiff segments={segments} />
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
            <span className="min-w-0 px-2 py-0.5">
              <Body
                className={`whitespace-pre-wrap break-all no-underline${op === "=" ? "" : " rounded px-1"}`}
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
