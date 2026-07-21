// Shared collapse mechanics for the per-agent duty rows of the GovOps and
// Facilitator responsibility reports. The atlas replicates many duty docs once
// per Prime Agent artifact; these helpers decide which same-titled docs are
// genuinely the same duty (dutyRowKeyer), fold replicas onto one
// representative row while recording every copy (mergeDutyDoc), and shape the
// merged result (finalizeDutySources). Row derivation itself stays in each
// report's module — only the collapse mechanism is shared, so a collapse fix
// can never again land in one report and miss the other.

import { stripMarkdownLinks } from "./stripMarkdownLinks";

// One doc merged into a collapsed duty row.
export interface MergedSource {
  docNo: string;
  uuid: string;
  agent?: string; // Prime Agent whose artifact subtree holds this copy
  // Facilitator org(s) this SPECIFIC copy's duty_for edge(s) name — distinct
  // from the row-level `facilitators` union (facilitatorResponsibilities.ts's
  // `_facs`), which can genuinely differ per copy: two per-agent-artifact
  // replicas of the same duty TEXT (dutyCollapseKey masks only the owning
  // agent's name, not facilitator org names) can still resolve to different
  // Operational Facilitators per Prime Agent. Only set by the facilitator
  // report; govops rows never populate this.
  facilitators?: string[];
}

// Per-agent-artifact subtree (A.6.1.1.<agent>.*) — the only place duty docs
// are replicated once per agent, so the only place same-title collapse is
// allowed. Outside it, generic structural titles ("Process Flow",
// "Validation") are reused across UNRELATED primitives/processes.
// fragile: doc_no prefix
export const AGENT_ARTIFACT_RE = /^A\.6\.1\.1\.\d+\./;

// Doc-number tokens (citation labels like "A.6.1.1.1.2.2 - Root Edit Proposal
// Submission", bare doc_no references, "NR-3"). Per-agent replicas cite into
// their OWN subtree, so the visible doc numbers differ per copy even when the
// duty is identical — they must not participate in the collapse key. Segments
// must be numeric (or the spec's varX suffix) so prose tokens like "U.S." or
// "SKY.eth" are left alone.
const DOC_NO_TOKEN_RE = /\b(?:[A-Z]{1,3}(?:\.(?:\d+|var\d+))+|NR-\d+)\b/g;

// Collapse key for one doc's content. Same-title docs replicated once per
// agent artifact may only collapse when the doc CONTENT is also the same —
// otherwise unrelated duties sharing a structural title ("Modification" of two
// different multisigs) get silently merged, dropping rows and misattributing
// agents. Key on the full content, NOT the duty_for edge's matched quote:
// quotes are truncated at a fixed length by build-graph, so their tails differ
// by however long the agent's name is. Two per-agent replicas of the same duty
// differ only by the OWNING agent's name ("reviews Spark's calculation" vs
// "reviews Grove's calculation"), the doc numbers / link targets of citations
// into their own subtrees, and trivial punctuation ("two-thirds" vs "two
// thirds", curly vs straight apostrophes) — so the key strips markdown links
// and doc-number tokens, masks the owning agent's name, and collapses every
// non-alphanumeric run before comparing. Only the OWNER is masked: a mention
// of a DIFFERENT agent is substantive content ("reviews Grove's collateral"
// under Spark ≠ "reviews Obex's collateral" under Keel), so masking every
// known agent name would over-merge those.
export function dutyCollapseKey(content: string, ownerAgent?: string): string {
  const maskRe = ownerAgent
    ? new RegExp(`\\b${ownerAgent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")
    : null;
  const stripped = stripMarkdownLinks(content).replace(DOC_NO_TOKEN_RE, " ");
  return (maskRe ? stripped.replace(maskRe, " ") : stripped)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface DocLike {
  id: string;
  doc_no: string;
  title: string;
  content: string;
}

// Per-derivation row-key builder. Inside the agent-artifact subtree,
// same-title docs share a key only when their content matches under
// dutyCollapseKey; everywhere else every doc keys by uuid so nothing merges.
// The content normalization is memoized per doc: several duty_for edges can
// target one doc (Core+Operational pairs, per-holder fan-out) and the key is a
// function of the doc, not the edge.
export function dutyRowKeyer(): (category: string, n: DocLike, ownerAgent?: string) => string {
  const byDoc = new Map<string, string>();
  return (category, n, ownerAgent) => {
    if (!AGENT_ARTIFACT_RE.test(n.doc_no)) return `${category}:uuid:${n.id}`;
    let k = byDoc.get(n.id);
    if (k === undefined) {
      k = `${n.title.trim().toLowerCase()}:${dutyCollapseKey(n.content, ownerAgent)}`;
      byDoc.set(n.id, k);
    }
    return `${category}:${k}`;
  };
}

export interface CollapsedDutyRow {
  docNo: string;
  uuid: string;
  duty: string;
  _sources: MergedSource[];
}

/** The initial sources list for a freshly created duty row. */
export function newDutySources(n: { doc_no: string; id: string }, agent?: string): MergedSource[] {
  return [{ docNo: n.doc_no, uuid: n.id, agent }];
}

// Fold another copy of a duty into an existing row: the lowest doc_no stays
// the representative, and every distinct doc is recorded as a source.
export function mergeDutyDoc(
  row: CollapsedDutyRow,
  n: { doc_no: string; id: string },
  duty: string,
  agent?: string,
): void {
  if (n.doc_no.localeCompare(row.docNo, undefined, { numeric: true }) < 0) {
    row.docNo = n.doc_no;
    row.uuid = n.id;
    row.duty = duty;
  }
  if (!row._sources.some((s) => s.uuid === n.id)) row._sources.push({ docNo: n.doc_no, uuid: n.id, agent });
}

// Shape the accumulated sources for the emitted row: covered agents are
// derived from the copies, sources are listed only when 2+ docs actually
// merged (docNo-ordered), and every merged uuid is marked seen so it can't
// resurface as a later-category row.
export function finalizeDutySources(
  sources: MergedSource[],
  seenDocIds: Set<string>,
): { agents?: string[]; sources?: MergedSource[] } {
  if (sources.length > 1) sources.sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true }));
  for (const s of sources) seenDocIds.add(s.uuid);
  const agents = [...new Set(sources.map((s) => s.agent).filter((a): a is string => !!a))];
  return { agents: agents.length ? agents : undefined, sources: sources.length > 1 ? sources : undefined };
}

/** A row's doc numbers: every merged copy when 2+ docs collapsed, else the representative alone. */
export function mergedDocNos(row: { docNo: string; sources?: MergedSource[] }, sep: string): string {
  return row.sources?.map((s) => s.docNo).join(sep) ?? row.docNo;
}

/**
 * Re-expand a collapsed row back into one entry per merged doc copy — CSV
 * exports must give every referenced doc its own UUID/Atlas Link cell, so a
 * joined "id1; id2" isn't a usable link. Table/search views still use the
 * collapsed row (mergedDocNos) since a grouped UI row is the point there.
 * `copies` may be undefined/singleton (nothing collapsed) — in which case the
 * row is returned unchanged. `applyCopy` narrows whatever per-row fields only
 * make sense for one specific doc (e.g. which single agent owns it) — shared
 * here so every collapse-then-CSV-export report (Facilitator/GovOps duty rows
 * via `expandSources` below, OEA tasks via `oeaReport.ts`'s `expandTaskCopies`)
 * uses the same guard-and-map skeleton instead of three hand-rolled copies.
 */
export function expandCopies<T>(
  row: T,
  copies: MergedSource[] | undefined,
  applyCopy: (row: T, copy: MergedSource) => T,
): T[] {
  if (!copies || copies.length <= 1) return [row];
  return copies.map((c) => applyCopy(row, c));
}

/**
 * `expandCopies` specialized for the Facilitator/GovOps `sources: MergedSource[]`
 * shape: each expanded row's Agent narrows to that specific copy's own owner
 * (never falling back to the representative's agent — a copy whose owner
 * couldn't be resolved should show blank, not another doc's agent), and the
 * merged `agents` list (every covered Prime) no longer applies to a single doc.
 */
export function expandSources<
  T extends {
    docNo: string;
    uuid: string;
    agent?: string;
    agents?: string[];
    sources?: MergedSource[];
    facilitators?: string[];
  },
>(row: T): T[] {
  return expandCopies(row, row.sources, (row, s) => ({
    ...row,
    docNo: s.docNo,
    uuid: s.uuid,
    agent: s.agent,
    agents: undefined,
    // A source's own facilitators narrows the row-level union down to just
    // this doc's — only set for facilitator rows (govops rows never populate
    // MergedSource.facilitators, so this is always a no-op there).
    facilitators: s.facilitators ?? row.facilitators,
  }));
}

/** Rows in, CSV rows out: how many `expandSources` will actually emit — for
 * DownloadCsvButton's row count, which must reflect the expanded total. */
export function expandedRowCount(rows: readonly { sources?: MergedSource[] }[]): number {
  return rows.reduce((n, r) => n + (r.sources && r.sources.length > 1 ? r.sources.length : 1), 0);
}
