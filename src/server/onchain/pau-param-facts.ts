// A deployment's parameters (max slippage, max exchange rate, recipients) as
// facts. A guard the page hides — one no switched-on rate limit lets act — is
// left out, the same cut the page makes (pauParamUse.ts).
import type { PauParam, PauSnapshot } from "../../lib/pau.ts";
import { paramTarget, paramTitle } from "../../lib/pauParamText.ts";
import { isGuardParam, paramUse } from "../../lib/pauParamUse.ts";
import { paramValue } from "../../lib/pauParamValue.ts";
import { EVM_ADDRESS_EXACT_RE } from "../../lib/patterns.ts";
import type { OnchainFact } from "./facts.ts";
import { setAt, type Base } from "./pau-fact-parts.ts";

const text = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));

/** The arguments other than the subject, in the words the page shows. */
function shown(p: PauParam): string[] {
  return Object.entries(p.args)
    .filter(([, v]) => String(v) !== p.subject)
    .map(([k, v]) => {
      const s = paramValue(p, k, text(v));
      if (!s) return `${k} ${text(v)}`;
      return s.kind === "text" ? s.text : s.address;
    });
}

/** A guard is on the page only while a rate limit for its operation is switched on. Any other parameter is. */
const onPage = (snap: PauSnapshot, p: PauParam) => !isGuardParam(p.event) || paramUse(snap, p).state === "on";

function paramFact(base: Base, snap: PauSnapshot, p: PauParam): OnchainFact {
  const use = isGuardParam(p.event) ? paramUse(snap, p) : null;
  const target = paramTarget(p.event, p.subject);
  const subject = target ?? p.subjectToken?.symbol ?? p.subject;
  const values = {
    event: p.event, subject: p.subject, shown: shown(p),
    ...(target ? { target } : {}),
    ...(p.subjectToken?.symbol ? { symbol: p.subjectToken.symbol } : {}),
    ...(use ? { in_use: use.state, guards: use.constants } : {}),
  };
  const addresses = [base.contract, ...(EVM_ADDRESS_EXACT_RE.test(p.subject) ? [p.subject.toLowerCase()] : [])];
  return {
    ...base, kind: "parameter", name: `${paramTitle(p.event)} · ${subject}`, name_source: null, atlas_doc_id: null,
    values, summary: { event: p.event, shown: values.shown }, set_at: setAt(base.chain, p.setAt),
    match: { hashes: [], addresses, docs: [] },
  };
}

/** The parameters the page lists for one contract. */
export function paramFacts(base: Base, snap: PauSnapshot, params: PauParam[]): OnchainFact[] {
  return params.filter((p) => onPage(snap, p)).map((p) => paramFact(base, snap, p));
}
