// Ticker copy for the harness's status events — zero model cost, read off the
// tool args and the evidence counts.

// Human-readable status detail off the tool args.
export function describeCall(name: string, args: Record<string, unknown>): string {
  if (name === "ask_external_msc" || name === "external_msc") {
    return "Consulting settlement sources (not Atlas)…";
  }
  // `query` is the standardized arg name (feedback_query_param_standard); `q`
  // is a deprecated alias kept for MCP back-compat — an MCP-era caller can
  // still send it, and without this fallback the ticker silently degrades to
  // the generic "Consulting atlas_query…" for a call that DID carry a query.
  const query = args.query ?? args.q;
  if (typeof query === "string" && query.length > 0) return `Searching the atlas for “${query.slice(0, 80)}”…`;
  if (name === "atlas_get") return "Reading documents…";
  return `Consulting ${name}…`;
}

// Copy for the verification stages. A turn can reach the audit with nothing
// retrieved — a meta-question, or a follow-up answered from the conversation —
// and "against 0 lookups" reads as a broken counter rather than a state. A
// count is printed only when it is real; the call site suppresses the stage
// entirely when there is no basis to name at all (see `grounded`), so the
// sourceless branch here only ever describes conversation grounding.
//
// The count is LOOKUPS, not sources, and the word matters. It is
// `evidence.length` — one per tool result — while everything further down the
// answer counts CITED DOCUMENTS: the chip row's "citations · 7"
// (Sources.tsx). One turn can answer four lookups with seven cited
// documents, so the same word would carry two counts on one screen.
// "Sources" means a cited document everywhere it appears; a tool call is a
// lookup.
const lookups = (n: number) => `${n} lookup${n === 1 ? "" : "s"}`;

function crossChecking(subject: string, evidenceCount: number): string {
  if (evidenceCount > 0) return `Cross-checking ${subject} against what ${lookups(evidenceCount)} returned…`;
  return `Cross-checking ${subject} against earlier turns of this conversation…`;
}

export function checkingDetail(citations: number, evidenceCount: number): string {
  return crossChecking(citations > 0 ? `${citations} cited claim${citations === 1 ? "" : "s"}` : "the answer", evidenceCount);
}

// Paragraph-mode twin: the audit already ran per paragraph, so the subject is
// paragraph count rather than citation count.
export function checkingDetailParagraphs(paragraphs: number, evidenceCount: number): string {
  return crossChecking(paragraphs > 0 ? `${paragraphs} paragraph${paragraphs === 1 ? "" : "s"}` : "the answer", evidenceCount);
}
