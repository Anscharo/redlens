import { atlasHref } from "@/lib/routes";
import { track } from "../../lib/analytics";
import type { VerifyContradiction } from "./api";
import type { VerifyState } from "./useChatStream";

// The expanded findings list behind VerifyBadge's chip. Split out of
// VerifyBadge.tsx (components.build: keep files small) — this is the "why"
// half, the chip is the "what". Refutation-only: the deterministic rows are
// unchanged hard failures, then one row per model-found contradiction BOTH
// auditors agreed on (a candidate the confirm judge did not agree with never
// reaches this component — the confirm gate is hard), then one row for a
// ruling if the answer issued one.
function ContradictionRow({ item, onAtlas }: { item: VerifyContradiction; onAtlas: (uuid: string) => void }) {
  return (
    <li data-status="contradicted">
      <q className="rlc-verify-quote">{item.answer}</q> — the atlas says: <q className="rlc-verify-quote">{item.evidence}</q>. {item.why}
      {item.uuid && (
        <>
          {" "}
          <a
            className="rlc-cite"
            href={atlasHref(item.uuid)}
            onClick={(e) => {
              e.preventDefault();
              track("chat_citation_click", { product: "chat", node_id: item.uuid });
              onAtlas(item.uuid!);
            }}
          >
            open the source
          </a>
        </>
      )}
    </li>
  );
}

export function hasFindings(verify: VerifyState): boolean {
  return (
    verify.invalidCitations.length > 0 ||
    verify.invalidDocNos.length > 0 ||
    verify.docNoMismatches.length > 0 ||
    verify.ungroundedQuotes.length > 0 ||
    verify.ungroundedAddresses.length > 0 ||
    verify.ungroundedCitationValues.length > 0 ||
    verify.lengthCapped ||
    verify.paramMismatches.length > 0 ||
    verify.completenessFailures.length > 0 ||
    verify.missingExternalDisclaimer ||
    verify.mscCitedAsAtlas.length > 0 ||
    verify.rulingIssued ||
    verify.contradictions.length > 0
  );
}

export function VerifyFindings({ verify, onAtlas }: { verify: VerifyState; onAtlas: (uuid: string) => void }) {
  // A clean verdict has nothing to list — an empty bordered box under
  // "Verifying content" reads as a rendering mistake, not as "all clear".
  if (!hasFindings(verify)) return null;
  return (
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
          {m.owner ? ` (${m.owner})` : ""} — our reading of the atlas has <strong>{m.actual}</strong>
        </li>
      ))}
      {verify.completenessFailures.map((d) => (
        <li key={d} data-status="contradicted">
          {d}
        </li>
      ))}
      {verify.missingExternalDisclaimer && (
        <li data-status="contradicted">settlement figures were used without saying they are not from the Atlas</li>
      )}
      {verify.mscCitedAsAtlas.map((m) => (
        <li key={m} data-status="contradicted">
          {m}
        </li>
      ))}
      {verify.rulingIssued && (
        <li data-status="contradicted">the answer issues a ruling instead of reporting what the atlas says</li>
      )}
      {verify.contradictions.map((c, i) => (
        <ContradictionRow key={`c${i}`} item={c} onAtlas={onAtlas} />
      ))}
    </ul>
  );
}
