import type { ReactNode } from "react";
import type { ParamMismatch, VerifyContradiction } from "./api";
import type { VerifyState } from "./chatTypes";
import { FindingCite } from "./FindingCite";

type OnAtlas = (uuid: string) => void;

/** One kind of verify finding: whether a verdict has any, and its `<li>` rows. */
export interface FindingRow {
  has: (v: VerifyState) => boolean;
  render: (v: VerifyState, onAtlas: OnAtlas) => ReactNode;
}

function listRow<T>(items: (v: VerifyState) => T[], key: (t: T, i: number) => string, body: (t: T, onAtlas: OnAtlas) => ReactNode): FindingRow {
  return {
    has: (v) => items(v).length > 0,
    render: (v, onAtlas) =>
      items(v).map((t, i) => (
        <li key={key(t, i)} data-status="contradicted">
          {body(t, onAtlas)}
        </li>
      )),
  };
}

function flagRow(flag: (v: VerifyState) => boolean, text: string): FindingRow {
  return { has: flag, render: (v) => flag(v) && <li data-status="contradicted">{text}</li> };
}

const same = (s: string) => s;

// "our reading of the atlas": the parameter table is SAbR's extraction, not
// atlas text. The doc title stands in for the machine kv key.
function ParamMismatchText({ m, onAtlas }: { m: ParamMismatch; onAtlas: OnAtlas }) {
  return (
    <>
      states <strong>{m.stated}</strong> for{" "}
      <FindingCite uuid={m.uuid} onAtlas={onAtlas}>
        {m.doc_no && <span className="rlc-cite-doc">{m.doc_no}</span>}
        <span className="rlc-cite-title">{m.title}</span>
      </FindingCite>
      {m.owner ? ` (${m.owner})` : ""} — our reading of the atlas has <strong>{m.actual}</strong>
    </>
  );
}

function ContradictionText({ item, onAtlas }: { item: VerifyContradiction; onAtlas: OnAtlas }) {
  return (
    <>
      <q className="rlc-verify-quote">{item.answer}</q> — the atlas says: <q className="rlc-verify-quote">{item.evidence}</q>. {item.why}
      {item.uuid && (
        <>
          {" "}
          <FindingCite uuid={item.uuid} onAtlas={onAtlas}>
            open the source
          </FindingCite>
        </>
      )}
    </>
  );
}

// Every input to the server's CheckReport.failed needs a row, or a red chip
// can't say why. Display order.
export const FINDING_ROWS: FindingRow[] = [
  listRow((v) => v.invalidCitations, same, (uuid) => <>cites a document that does not exist: <code>{uuid}</code></>),
  listRow((v) => v.invalidDocNos, same, (d) => <>document number does not exist in the atlas: <code>{d}</code></>),
  listRow((v) => v.docNoMismatches, same, (m) => <>document number doesn’t match its link: {m}</>),
  listRow((v) => v.ungroundedQuotes, same, (q) => <>quote not found in any retrieved source: “{q.length > 120 ? `${q.slice(0, 120)}…` : q}”</>),
  listRow((v) => v.ungroundedAddresses, same, (a) => <>address not found in any retrieved source: <code>{a}</code></>),
  // Already a full sentence server-side.
  listRow((v) => v.ungroundedCitationValues, same, same),
  flagRow((v) => v.lengthCapped, "the answer was cut off by the output length limit before it finished"),
  listRow((v) => v.paramMismatches, (m) => `${m.uuid}:${m.stated}`, (m, onAtlas) => <ParamMismatchText m={m} onAtlas={onAtlas} />),
  listRow((v) => v.completenessFailures, same, same),
  flagRow((v) => v.missingExternalDisclaimer, "settlement figures were used without saying they are not from the Atlas"),
  listRow((v) => v.mscCitedAsAtlas, same, same),
  flagRow((v) => v.rulingIssued, "the answer issues a ruling instead of reporting what the atlas says"),
  listRow((v) => v.contradictions, (_c, i) => `c${i}`, (c, onAtlas) => <ContradictionText item={c} onAtlas={onAtlas} />),
];
