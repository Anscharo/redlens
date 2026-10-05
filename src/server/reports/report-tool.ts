// The descriptor every atlas_report_* tool declares in its own report module.
// defineReportTool turns one into an AtlasTool: it builds the input shape from
// the shared parameters the report takes, reads them back into ReportArgs in
// one place, and carries `promptBlurb`, the line the chat system prompt lists
// the report under. Registering a report tool is one line in REPORT_TOOLS
// (./index.ts); the registry, MCP, the /connect page and the system prompt all
// read that list.
import { z } from "zod";
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { readOnlyAtlasTool, type AtlasTool } from "../chat/tools/tool-types.ts";

// Whether to include source doc_nos / evidence chains / raw param tuples.
// Default true; false yields a leaner rollup with resolved display fields only.
const INCLUDE_PROVENANCE = z
  .boolean()
  .optional()
  .default(true)
  .describe("Include provenance (source doc_nos / evidence chains / raw params) for each field (default true; set false for a leaner rollup).");

// The row-list reports that mirror a filterable report page take a text filter
// applied server-side with the SAME field logic the page's header box uses, so
// a scoped query returns only matching rows instead of the whole report. Broad
// (every space-separated word must appear somewhere in the row) by default; a
// fully quoted "…"/'…' value selects phrase/case-sensitive matching.
const FILTER_PARAM = z
  .string()
  .optional()
  .describe(
    'Optional text filter over the report rows (same matching as the report page): every space-separated word must appear ' +
      'somewhere in a row (name, doc_no, agent, party, status, address, …). Wrap in "double quotes" for an exact phrase. ' +
      "Omit to return the whole report. Use it to scope large reports (e.g. one agent/entity) and keep the response small.",
  );

const REPORT_PARAMS = { include_provenance: INCLUDE_PROVENANCE, filter: FILTER_PARAM } as const;

export interface ReportArgs {
  include_provenance: boolean;
  filter?: string;
}

// An absent include_provenance means true; an empty filter means no filter.
export function reportArgs(a: Record<string, unknown>): ReportArgs {
  return {
    include_provenance: (a.include_provenance as boolean | undefined) ?? true,
    filter: (a.filter as string | undefined) || undefined,
  };
}

export interface ReportToolSpec {
  name: `atlas_report_${string}`;
  // MCP annotation title, e.g. "Atlas Report Multisigs".
  title: string;
  description: string;
  // What the system prompt's Tools section says after the tool's name: what
  // the report holds and the question shape it answers, ending in a period.
  promptBlurb: string;
  // The shared parameters this report accepts, in input-schema order.
  params: readonly (keyof typeof REPORT_PARAMS)[];
  build: (ix: Indexes, args: ReportArgs) => ToolResult | Promise<ToolResult>;
}

export interface ReportTool extends AtlasTool {
  promptBlurb: string;
}

export function defineReportTool(spec: ReportToolSpec): ReportTool {
  const shape: z.ZodRawShape = {};
  for (const p of spec.params) shape[p] = REPORT_PARAMS[p];
  return {
    name: spec.name,
    annotations: readOnlyAtlasTool(spec.title),
    description: spec.description,
    promptBlurb: spec.promptBlurb,
    shape,
    handler: (ix, a) => spec.build(ix, reportArgs(a)),
  };
}
