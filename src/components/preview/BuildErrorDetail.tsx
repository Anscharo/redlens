// Failed-build detail: the captured stderr tail, plus — when the message
// carries exactly two backticked values (the atlas-parser invariant format) —
// an expected/found line pair with a CHARACTER-level diff, so near-invisible
// defects (a trailing dot in a docNo) light up instead of hiding in plain text.

type CharOp = ["=" | "-" | "+", string];

// LCS over characters; inputs are short (doc numbers, uuids), so the O(m·n)
// table is trivial. Merges consecutive same-op chars into segments.
function charOps(a: string, b: string): CharOp[] {
  const m = a.length;
  const n = b.length;
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const ops: CharOp[] = [];
  let i = m;
  let j = n;
  const push = (op: CharOp[0], ch: string) => {
    const last = ops[ops.length - 1];
    if (last && last[0] === op) last[1] = ch + last[1];
    else ops.push([op, ch]);
  };
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      i--;
      j--;
      push("=", a[i]);
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      j--;
      push("+", b[j]);
    } else {
      i--;
      push("-", a[i]);
    }
  }
  return ops.reverse();
}

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
  const pair = ticked.length === 2 && ticked[0] !== ticked[1] ? charOps(ticked[0], ticked[1]) : null;
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
