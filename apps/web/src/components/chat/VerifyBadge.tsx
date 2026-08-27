import { useState } from "react";
import { atlasHref } from "@/lib/routes";
import { track } from "../../lib/analytics";
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

export function VerifyBadge({ verify, onAtlas }: { verify: VerifyState; onAtlas: (uuid: string) => void }) {
  const [open, setOpen] = useState(false);
  if (verify.status === "unverified") return null;

  const flagged = verify.claims.filter((c) => c.status !== "supported");
  const issues =
    flagged.length +
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
          {verify.invalidDocNos.map((d) => (
            <li key={d} data-status="contradicted">
              document number does not exist in the atlas: <code>{d}</code>
            </li>
          ))}
          {verify.docNoMismatches.map((m) => (
            <li key={m} data-status="contradicted">
              document number doesn’t match its link: {m}
            </li>
          ))}
          {verify.ungroundedQuotes.map((q) => (
            <li key={q} data-status="contradicted">
              quote not found in any retrieved source: “{q.length > 120 ? `${q.slice(0, 120)}…` : q}”
            </li>
          ))}
          {verify.ungroundedAddresses.map((a) => (
            <li key={a} data-status="contradicted">
              address not found in any retrieved source: <code>{a}</code>
            </li>
          ))}
          {/* Already a full sentence server-side ("0.2% cited to A.1.1 (Title)
              but absent from it") — don't prefix it with a label or it reads
              twice. */}
          {verify.ungroundedCitationValues.map((v) => (
            <li key={v} data-status="contradicted">
              {v}
            </li>
          ))}
          {verify.lengthCapped && (
            <li data-status="contradicted">the answer was cut off by the output length limit before it finished</li>
          )}
          {/* "our reading of the atlas" is deliberate: the parameter table is
              SAbR's extraction, not atlas text, and a badge that says "the
              atlas says X" would present our parse as the source itself. The
              doc title is shown rather than the extracted kv key, which is
              machine vocabulary ("maxamount") no reader would recognise. */}
          {verify.paramMismatches.map((m) => (
            <li key={`${m.uuid}:${m.stated}`} data-status="contradicted">
              states <strong>{m.stated}</strong> for{" "}
              <a
                className="rlc-cite"
                href={atlasHref(m.uuid)}
                onClick={(e) => {
                  e.preventDefault();
                  track("chat_citation_click", { product: "chat", node_id: m.uuid });
                  onAtlas(m.uuid);
                }}
              >
                {m.doc_no && <span className="rlc-cite-doc">{m.doc_no}</span>}
                <span className="rlc-cite-title">{m.title}</span>
              </a>
              {m.owner ? ` (${m.owner})` : ""} — our reading of the atlas has{" "}
              <strong>{m.actual}</strong>
            </li>
          ))}
          {verify.completenessFailures.map((d) => (
            <li key={d} data-status="contradicted">
              {d}
            </li>
          ))}
          {verify.missingExternalDisclaimer && (
            <li data-status="contradicted">
              settlement figures were used without saying they are not from the Atlas
            </li>
          )}
          {verify.mscCitedAsAtlas.map((m) => (
            <li key={m} data-status="contradicted">
              {m}
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
