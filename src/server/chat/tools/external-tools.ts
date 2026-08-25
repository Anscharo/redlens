// External (non-atlas) tools. MCP registers EXTERNAL_TOOLS (external_msc = curated view JSON).
// Chat appends ask_external_msc only and intercepts it to run an isolated sub-agent.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ToolResult } from "./tools.ts";
import { readForumTopics } from "../../forum.ts";
import { loadSettlementsFromDisk } from "../../settlements.ts";
import { ASK_EXTERNAL_MSC, EXTERNAL_MSC, MSC_REQUIRED_DISCLAIMER } from "../../external/envelope.ts";
import { MSC_METRICS, MSC_VIEWS, buildMscView, type MscViewArgs } from "../../external/msc-views.ts";
import { runMscSubagent } from "../../external/subagent.ts";
import type { JsonCall } from "../llm.ts";

export { ASK_EXTERNAL_MSC, EXTERNAL_MSC };

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export interface ExternalTool {
  name: string;
  description: string;
  whenToUse?: string;
  shape: z.ZodRawShape;
  annotations?: ToolAnnotations;
  handler: (ix: Indexes, args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

export function externalToolDescription(t: ExternalTool): string {
  return t.whenToUse ? `${t.description}\n\nWhen to use: ${t.whenToUse}` : t.description;
}

const VIEW_SHAPE = {
  view: z
    .enum(MSC_VIEWS)
    .optional()
    .describe("month (default), series, compare, venues, or terms."),
  prime: z.string().optional().describe("Prime folder slug, e.g. spark. Or pass actor_slug from Radar."),
  actor_slug: z.string().optional().describe("Radar actor slug (spark, spark-party)."),
  month: z.string().optional().describe("YYYY-MM, or 'latest'."),
  metric: z.enum(MSC_METRICS).optional().describe("Rank key for view=compare."),
  last_n: z.number().int().min(1).max(24).optional().describe("How many months for view=series (default 12)."),
  from: z.string().optional(),
  to: z.string().optional(),
};

async function forumTopicsSafe() {
  try {
    return await Promise.race([
      readForumTopics(undefined, "msc"),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("forum_topics timeout")), 1500);
      }),
    ]);
  } catch {
    return [];
  }
}

export async function runExternalMscView(args: Record<string, unknown>): Promise<ToolResult> {
  const bundle = await loadSettlementsFromDisk();
  const topics = await forumTopicsSafe();
  return buildMscView(bundle, topics, args as MscViewArgs);
}

export const EXTERNAL_TOOLS: ExternalTool[] = [
  {
    name: EXTERNAL_MSC,
    whenToUse:
      "The question is about published Monthly Settlement Cycle dollar figures, venue books, or the Sky Forum summary URL for a cycle — not Atlas process text.",
    annotations: { ...READ_ONLY, title: "External MSC (not Atlas)" },
    description:
      "NOT Atlas. Returns a curated Monthly Settlement Cycle view from Soter Labs workbooks (OEA calculations, not the on-chain GovOps spell) plus the indexed Sky Forum permalink when known. Views: month (default), series, compare (rank primes), venues (opt-in), terms. Never present these figures as Atlas text. Do not add cost of funds to To Sky; supply kept is prime agent revenue minus cost of funds, not Σ Profit to Grove.",
    shape: VIEW_SHAPE,
    handler: (_ix, a) => runExternalMscView(a),
  },
];

export const ASK_EXTERNAL_MSC_DESCRIPTION =
  "NOT Atlas. Delegate a Monthly Settlement Cycle question to an isolated helper that reads Soter Labs workbooks (OEA calculations, not the GovOps spell) and the indexed Sky Forum permalink. " +
  "You receive a short brief with a required disclaimer — repeat that disclaimer in the answer. Cite the workbook month/prime and/or the forum URL; never cite these dollars as /atlas/<uuid>. " +
  "Views: month (default), series, compare, venues, terms. Process questions ('what is the Monthly Settlement Cycle?') still use atlas tools.";

export const ASK_EXTERNAL_MSC_SHAPE: z.ZodRawShape = {
  ...VIEW_SHAPE,
  question: z.string().optional().describe("The user's settlement question, if tighter than the whole turn."),
};

export async function runAskExternalMsc(
  args: Record<string, unknown>,
  question: string,
  jsonCall?: JsonCall,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const view = await runExternalMscView(args);
  const rec = view as Record<string, unknown>;
  if (rec.error && rec.view !== "terms") {
    return {
      source_class: "external",
      not_atlas: true,
      required_disclaimer: MSC_REQUIRED_DISCLAIMER,
      ...rec,
    };
  }
  const brief = await runMscSubagent({
    question: typeof args.question === "string" && args.question.trim() ? String(args.question) : question,
    view: rec,
    jsonCall,
    signal,
  });
  return { ...brief };
}
