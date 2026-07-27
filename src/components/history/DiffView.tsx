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
            <span key={i} style={WORD_ADDED_STYLE}>
              {text}
            </span>
          );
        if (op === "-")
          return (
            <span key={i} style={WORD_REMOVED_STYLE}>
              {text}
            </span>
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
      className="mt-2 rounded overflow-x-auto mono text-[11px] leading-relaxed"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {refined.map((line, i) => {
        const op = line[0];

        if (op === "…") {
          return (
            <div key={i} className="px-2 py-0.5 select-none" style={{ color: "var(--tan-3)" }}>
              ···
            </div>
          );
        }

        if (op === "~") {
          const segments = line[1] as WordSegment[];
          return (
            <div
              key={i}
              className="flex gap-1.5 px-2 py-0.5"
              style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
            >
              <span
                className="shrink-0 select-none w-3 text-center"
                style={{ color: "var(--tan-3)" }}
              >
                ~
              </span>
              <IntralineDiff segments={segments} />
            </div>
          );
        }

        const text = line[1] as string;
        return (
          <div
            key={i}
            className="flex gap-1.5 px-2 py-0.5 whitespace-pre-wrap break-all"
            style={{ background: DIFF_LINE_BG[op] }}
          >
            <span
              className="shrink-0 select-none w-3 text-center"
              style={{ color: DIFF_LINE_COLOR[op] }}
            >
              {DIFF_LINE_PREFIX[op]}
            </span>
            <span style={{ color: op === "=" ? "var(--tan-2)" : DIFF_LINE_COLOR[op] }}>
              {text || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
