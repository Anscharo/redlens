import { useState } from "react";
import type { VerifyState } from "./useChatStream";
import { VerifyFindings } from "./VerifyFindings";

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

  const issues =
    verify.contradictions.length +
    (verify.rulingIssued ? 1 : 0) +
    verify.invalidCitations.length +
    verify.invalidDocNos.length +
    verify.docNoMismatches.length +
    verify.ungroundedQuotes.length +
    verify.ungroundedAddresses.length +
    // All three are hard failures server-side, and each can be a turn's ONLY
    // finding. Omitting them from the count let such a turn render a red chip
    // that refused to expand and explain itself.
    verify.ungroundedCitationValues.length +
    verify.paramMismatches.length +
    verify.completenessFailures.length +
    (verify.missingExternalDisclaimer ? 1 : 0) +
    verify.mscCitedAsAtlas.length +
    (verify.lengthCapped ? 1 : 0);
  const label = chipLabel(verify);
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
      {verify.notFound.length > 0 && (
        <p className="rlc-verify-notfound">
          {verify.notFound.length} statement{verify.notFound.length === 1 ? "" : "s"} not found in the retrieved sources
        </p>
      )}
      {open && <VerifyFindings verify={verify} onAtlas={onAtlas} />}
    </div>
  );
}
