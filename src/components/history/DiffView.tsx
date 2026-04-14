import type { DiffLine, WordSegment } from "../../lib/history";

const DIFF_LINE_BG: Record<string, string> = {
  "+": "color-mix(in srgb, var(--depth-6) 12%, transparent)",
  "-": "#4a1010",
  "=": "transparent",
};
const DIFF_LINE_COLOR: Record<string, string> = {
  "+": "var(--depth-6)",
  "-": "#e8d5d5",
  "=": "var(--tan-3)",
};
const DIFF_LINE_PREFIX: Record<string, string> = { "+": "+", "-": "−", "=": " " };

const WORD_ADDED_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--depth-6) 30%, transparent)",
  color: "var(--depth-6)",
  borderRadius: 2,
};
const WORD_REMOVED_STYLE: React.CSSProperties = {
  background: "#4a1010",
  color: "#e8d5d5",
  borderRadius: 2,
  textDecoration: "line-through",
};

function IntralineDiff({ segments }: { segments: WordSegment[] }) {
  return (
    <span className="whitespace-pre-wrap break-all">
      {segments.map((seg, i) => {
        const [op, text] = seg;
        if (op === "+") return <span key={i} style={WORD_ADDED_STYLE}>{text}</span>;
        if (op === "-") return <span key={i} style={WORD_REMOVED_STYLE}>{text}</span>;
        return <span key={i} style={{ color: "var(--tan-2)" }}>{text}</span>;
      })}
    </span>
  );
}

export function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      className="mt-2 rounded overflow-x-auto mono text-[10px] leading-relaxed"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {lines.map((line, i) => {
        const op = line[0];

        if (op === "…") {
          return (
            <div key={i} className="px-2 py-0.5 select-none" style={{ color: "var(--tan-3)" }}>···</div>
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
              <span className="shrink-0 select-none w-3 text-center" style={{ color: "var(--tan-3)" }}>~</span>
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
            <span className="shrink-0 select-none w-3 text-center" style={{ color: DIFF_LINE_COLOR[op] }}>
              {DIFF_LINE_PREFIX[op]}
            </span>
            <span style={{ color: op === "=" ? "var(--tan-2)" : DIFF_LINE_COLOR[op] }}>{text || "\u00a0"}</span>
          </div>
        );
      })}
    </div>
  );
}
