import { useState } from "react";
import type { VerifyState } from "./useChatStream";

// Verification chip for an assistant answer (chat reliability harness).
// Sits by the Sources cluster: "verifying…" while the audit runs, then the
// resolved verdict; flagged claims expand on click. "unverified" (harness off
// or degraded) renders nothing — absence of a badge is the quiet default.
const LABEL: Record<string, string> = {
  checking: "verifying…",
  pass: "verified against the atlas",
  warn: "caution",
  fail: "failed verification",
  revised: "revised after a verification check",
};

export function VerifyBadge({ verify }: { verify: VerifyState }) {
  const [open, setOpen] = useState(false);
  if (verify.status === "unverified") return null;

  const flagged = verify.claims.filter((c) => c.status !== "supported");
  const issues = flagged.length + verify.invalidCitations.length + verify.ungroundedQuotes.length;
  const label =
    verify.status === "warn"
      ? `caution: ${issues} unsupported claim${issues === 1 ? "" : "s"}`
      : LABEL[verify.status];
  const expandable = issues > 0 && verify.status !== "checking";

  return (
    <div className="rlc-verify">
      <button
        className="rlc-verify-chip"
        data-status={verify.status}
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="rlc-verify-dot" aria-hidden="true" />
        {label}
      </button>
      {open && (
        <ul className="rlc-verify-claims">
          {verify.invalidCitations.map((uuid) => (
            <li key={uuid} data-status="contradicted">
              cites a document that does not exist: <code>{uuid}</code>
            </li>
          ))}
          {verify.ungroundedQuotes.map((q) => (
            <li key={q} data-status="contradicted">
              quote not found in any retrieved source: “{q.length > 120 ? `${q.slice(0, 120)}…` : q}”
            </li>
          ))}
          {flagged.map((c, i) => (
            <li key={i} data-status={c.status}>
              <span className="rlc-verify-claim-status">{c.status}</span> {c.claim}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
