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

// Disclosure for `verify.notFound` — statements the auditor couldn't locate
// in evidence at all. Deliberately informational, never an error: it never
// touches `hasFindings`/the chip (see the `notFound` comment in
// chatTypes.ts/VerifyState), so its label must not imply something went
// wrong. Same toggle language as the stage rows (.rlc-stage-toggle / the
// trace caret) — a plain disclosure, not a warning.
function NotFoundNote({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const n = items.length;
  return (
    <div className="rlc-verify-notfound">
      <button
        type="button"
        className="rlc-verify-notfound-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rlc-trace-caret" data-open={open} aria-hidden="true">
          ▾
        </span>
        {n} statement{n === 1 ? "" : "s"} the retrieved sources don't cover
      </button>
      {open && (
        <ul className="rlc-verify-notfound-list">
          {items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
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
      <NotFoundNote items={verify.notFound} />
      {open && <VerifyFindings verify={verify} onAtlas={onAtlas} />}
    </div>
  );
}
