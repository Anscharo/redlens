// Failed-build detail: the captured stderr tail, plus — when the message
// carries exactly two backticked values (the atlas-parser invariant format) —
// an expected/found line pair with a CHARACTER-level diff, so near-invisible
// defects (a trailing dot in a docNo) light up instead of hiding in plain text.

import { charDiff } from "../../lib/diffCore";

type CharOp = ["=" | "-" | "+", string];

const MARK: React.CSSProperties = {
  background: "var(--diff-removed-bg)",
  color: "var(--diff-removed-fg)",
  borderRadius: 2,
  fontWeight: 700,
};

function DiffLine({ label, ops, keep }: { label: string; ops: CharOp[]; keep: "-" | "+" }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-right" style={{ color: "var(--tan-3)" }}>{label}</span>
      <span>
        {ops
          .filter(([op]) => op === "=" || op === keep)
          .map(([op, text], i) =>
            op === "=" ? (
              <span key={i}>{text}</span>
            ) : (
              <span key={i} style={MARK}>{text === " " || text.trim() === "" ? "·".repeat(text.length) : text}</span>
            ),
          )}
      </span>
    </div>
  );
}

export function BuildErrorDetail({ message }: { message: string }) {
  const ticked = [...message.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  const pair = ticked.length === 2 && ticked[0] !== ticked[1] ? (charDiff(ticked[0], ticked[1]) as CharOp[]) : null;
  return (
    <>
      <pre
        className="mono text-[11px] text-left whitespace-pre-wrap max-w-2xl px-4 py-3 rounded"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--tan-2)" }}
      >
        {message}
      </pre>
      {pair && (
        <div
          className="mono text-[12px] text-left max-w-2xl px-4 py-3 rounded flex flex-col gap-1"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--tan)" }}
        >
          <DiffLine label="expected" ops={pair} keep="-" />
          <DiffLine label="found" ops={pair} keep="+" />
        </div>
      )}
    </>
  );
}
