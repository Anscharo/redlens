// The shape every report entry in this directory declares. One entry is the
// whole registration of a report's metadata: everything routes.ts and
// reportCatalog.ts publish about a report is derived from these entries.

/** A search pill: its short label and the input's placeholder. */
export interface ScopeConfig {
  label: string;
  placeholder: string;
}

/**
 * Where a report's rows come from — the axis that tells a reader how much to
 * trust what they are looking at, and how current it is.
 *
 * `live` is the norm and is deliberately not badged in the UI: a badge means
 * "there is a caveat here".
 */
export type ReportProvenance =
  | "live" // recomputed from the served atlas on every visit
  | "ai-assessed" // LLM-drafted against a published rubric, human-reviewed
  | "curated"; // hand-maintained; can lag the atlas until someone refreshes it

/** Keys of REPORT_GROUP_DEFS in groups.ts. */
export type ReportGroupKey = "roles" | "onchain" | "rules" | "structure" | "health";

export interface ReportMeta {
  /** The /reports/<id> slug, the analytics `report` property and the CSV slug. */
  id: string;
  /** h1, document title, index card title, visit history and chat page context. */
  title: string;
  /** One line on what the report shows: the index card and the chat's page context. */
  description: string;
  group: ReportGroupKey;
  provenance: ReportProvenance;
  /** Search pill on the report page. Absent: the generic "reports" pill. */
  scope?: ScopeConfig;
  /** `atlas_report_*` tool that returns this report in one call; tool-registry.test.ts checks it exists. */
  chatTool?: string;
}
