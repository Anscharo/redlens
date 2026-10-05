// Evidence entries the verifier reads beyond this turn's tool results: the
// live schema, the parameter table rows the audited text mentions, and the
// one assembly order every refute prompt shares.
import type { Indexes } from "../../retrieval/indexes.ts";
import { findParamsMentioned } from "../verify/param-checks.ts";
import type { EvidenceEntry } from "../verify/verifier.ts";
import { atlasDescribe } from "../tools/tools.ts";

// The live schema the system prompt hands the model (doc counts, type + edge
// vocabularies) is legitimate knowledge it never retrieves via tools — without
// this entry the verifier flags TRUE schema facts ("the atlas has ~N docs")
// as invented.
export const schemaEvidence = (ix: Indexes): EvidenceEntry => ({
  label: "[E0]",
  tool: "atlas_schema",
  args: "(live schema, injected into the assistant's system prompt)",
  content: JSON.stringify(atlasDescribe(ix)),
});

type ParamMatch = ReturnType<typeof findParamsMentioned>[number];

// Rows with an owner first, then longer (more specific) names first.
function ownerFirstLongestName(a: ParamMatch, b: ParamMatch): number {
  const aOwner = a.row.owner ? 0 : 1;
  const bOwner = b.row.owner ? 0 : 1;
  return aOwner !== bOwner ? aOwner - bOwner : b.row.name.length - a.row.name.length;
}

// [E-const]: deterministic parameter-table rows the answer text mentions
// (docs/research/synlang-wiki.md §3.1) — evidence for the VERIFIER only,
// never the answerer's prompt/loop (a measured ~6x loop-amplification cost is
// why). Gives the refute slice a real value to check a numeric/status claim
// against even on a turn that never re-retrieved the owning doc, so it can
// flag a WRONG figure as a genuine contradiction rather than having nothing
// to compare against. (The absence contract, verify/absence.ts's
// refuteAbsenceSentences, does NOT read this entry — it queries the parameter
// index directly, so an absence sentence is refuted even when [E-const]
// itself found nothing to attach to the answer's own claims.) Uses the same
// broadened name-or-title matcher as the hard check
// (param-checks.ts's findParamsMentioned) — a false positive here is cheap
// (one extra evidence row, not a wrongful failure), so the ambiguous-doc
// suppression the hard check needs is deliberately skipped.
const CONST_EVIDENCE_CAP = 40;
function constEvidence(ix: Indexes, answerText: string): EvidenceEntry | null {
  const matches = findParamsMentioned(answerText, ix);
  if (matches.length === 0) return null;
  const ranked = [...matches].sort(ownerFirstLongestName).slice(0, CONST_EVIDENCE_CAP);
  return {
    label: "[E-const]",
    tool: "atlas_param_table",
    args: "(deterministic parameter-table rows matching the answer — derived from the served atlas at index build)",
    content: JSON.stringify(
      ranked.map(({ row }) => ({ name: row.name, value: row.value, unit: row.unit, owner: row.owner, doc_no: row.doc_no, uuid: row.uuid })),
    ),
  };
}

// ONE assembly order, shared by the per-paragraph and whole-answer refute
// prompts. [E-const] goes last because it is the only entry derived from the
// text being audited, and buildRefutePrompt puts that text after the
// evidence — so everything ahead of [E-const] is a byte-identical prefix
// across the fan-out, which is what a provider's cache can reuse.
export function refuteEvidenceBuilder(ix: Indexes, schemaEv: EvidenceEntry, prevEvidence: EvidenceEntry | null) {
  return (turnEvidence: EvidenceEntry[], auditedText: string): EvidenceEntry[] => {
    const ce = constEvidence(ix, auditedText);
    return [schemaEv, ...(prevEvidence ? [prevEvidence] : []), ...turnEvidence, ...(ce ? [ce] : [])];
  };
}
