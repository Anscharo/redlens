// The descriptor each report module declares; defineReportTool turns it into an
// AtlasTool with the shared parameters it takes.
import { z } from "zod";
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { readOnlyAtlasTool, type AtlasTool } from "../chat/tools/tool-types.ts";

const INCLUDE_PROVENANCE = z
  .boolean()
  .optional()
  .default(true)
  .describe("Include provenance (source doc_nos / evidence chains / raw params) for each field (default true; set false for a leaner rollup).");

// Uses the SAME field logic as the report page's header box, server-side.
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
  title: string;
  description: string;
  // The system prompt's Tools-section line for this report, ending in a period.
  promptBlurb: string;
  // In input-schema order.
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
