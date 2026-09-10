import { useState } from "react";
import type { VerifyState } from "./useChatStream";
import { VerifyFindings, hasFindings } from "./VerifyFindings";

// Verification chip for an assistant answer (chat reliability harness,
// refutation-only design — the verifier only ever reports what the evidence
// CONTRADICTS, never what it confirms). Sits by the Sources cluster:
// "verifying…" while the audit runs, then the resolved verdict; findings
// expand on click. "unverified" (harness off or degraded) renders nothing —
// absence of a badge is the quiet default.
const LABEL: Record<string, string> = {
  checking: "verifying…",
  pass: "no contradictions found",
};

function chipLabel(verify: VerifyState): string {
  if (verify.status === "checking" || verify.status === "pass") return LABEL[verify.status];
  if (verify.status === "fail") {
    const n = verify.contradictions.length;
    return n > 0 ? `${n} statement${n === 1 ? "" : "s"} disputed by the atlas` : "failed verification";
  }
  // warn — ruling-only now that an unagreed candidate can never drive `warn`.
  return "caution: the answer issues a ruling";
}

export function VerifyBadge({ verify, onAtlas }: { verify: VerifyState; onAtlas: (uuid: string) => void }) {
  const [open, setOpen] = useState(false);
  if (verify.status === "unverified") return null;

  // Every hard failure counts, each of which can be a turn's ONLY finding —
  // omitting one let a red chip refuse to expand and explain itself. The
  // list lives in hasFindings so the chip and the findings list can never
  // disagree about whether there is anything to show.
  const label = chipLabel(verify);
  const expandable = hasFindings(verify) && verify.status !== "checking";

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
      {verify.notFound.length > 0 && (
        <p className="rlc-verify-notfound">
          {verify.notFound.length} statement{verify.notFound.length === 1 ? "" : "s"} not found in the retrieved sources
        </p>
      )}
      {open && <VerifyFindings verify={verify} onAtlas={onAtlas} />}
    </div>
  );
}
