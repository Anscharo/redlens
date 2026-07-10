// atlas_report dispatcher. One curated, model-ready report per `kind`, too
// expensive for the LLM to assemble interactively from primitive graph calls.
// Kinds are added one vertical slice at a time; only implemented kinds are
// advertised in the tool's zod enum (see tool-registry.ts) so the model never
// calls an unbuilt one.
import type { Indexes } from "../indexes.ts";
import type { ToolResult } from "../tools.ts";
import { buildMultisigsReport } from "./multisigs.ts";

// Planned superset (docs/plans/chatbot-readiness-remediation-plan.md §1.1):
// "rewards" | "active_data" | "multisigs" | "transfers" | "primitive_matrix" | "actors".
export type ReportKind = "multisigs";

export interface AtlasReportArgs {
  kind: ReportKind;
  include_provenance?: boolean;
}

export function atlasReport(ix: Indexes, args: AtlasReportArgs): ToolResult {
  const include_provenance = args.include_provenance ?? true;
  switch (args.kind) {
    case "multisigs":
      return buildMultisigsReport(ix, { include_provenance });
    default:
      return { error: `Unknown report kind '${args.kind as string}'.` };
  }
}
