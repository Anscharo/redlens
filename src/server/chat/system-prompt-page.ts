// The "Current page" section of the chat system prompt: what the user is
// looking at, and — on a report page backed by a report tool — how to load and
// filter that report.
import { TOOLS_BY_NAME } from "./tools/tool-registry.ts";
import { REPORT_TITLES, REPORT_DESCRIPTIONS } from "../../lib/routes.ts";

// reportName on the wire is the display title (REPORT_TITLES[id]), not the id —
// reverse-look-up to find the matching one-line description, if any.
const TITLE_TO_REPORT_ID: Record<string, string> = Object.fromEntries(
  Object.entries(REPORT_TITLES).map(([id, title]) => [title, id]),
);

export interface PageContext {
  path?: string; // route, e.g. /atlas/<uuid>
  nodeId?: string; // selected atlas node UUID
  nodeTitle?: string;
  nodeDocNo?: string;
  actorSlug?: string; // radar actor
  mscMonth?: string; // selected MSC month on /radar/:slug/settlements (YYYY-MM)
  reportName?: string;
  reportTool?: string; // client hint: the atlas_report_* tool backing this report page
  reportFilter?: string; // the report page's active text filter, if any
}

// The client sends reportTool as a hint; never trust it verbatim in the prompt.
// Accept it only if it names a real, registered atlas_report_* tool — otherwise
// a stray/renamed/hostile value can't steer the model at a non-existent tool.
export function validReportTool(ctx?: PageContext): string | null {
  const t = ctx?.reportTool;
  if (!t || !t.startsWith("atlas_report_")) return null;
  return TOOLS_BY_NAME.has(t) ? t : null;
}

export function pageContextLine(ctx?: PageContext): string | null {
  if (!ctx) return null;
  if (ctx.nodeId) return `Atlas node "${ctx.nodeTitle ?? ctx.nodeId}"${ctx.nodeDocNo ? ` (${ctx.nodeDocNo})` : ""}, UUID ${ctx.nodeId}`;
  if (ctx.actorSlug) {
    const settlements = ctx.path?.includes("/settlements");
    if (settlements) {
      const month = ctx.mscMonth ? ` month ${ctx.mscMonth}` : "";
      return `Radar monthly settlement page for "${ctx.actorSlug}"${month}. Dollar figures are not Atlas — call ask_external_msc with view=month, actor_slug="${ctx.actorSlug}"${ctx.mscMonth ? `, month="${ctx.mscMonth}"` : ""}.`;
    }
    return `Radar actor page for "${ctx.actorSlug}"`;
  }
  if (ctx.reportName) {
    const id = TITLE_TO_REPORT_ID[ctx.reportName];
    const description = id ? REPORT_DESCRIPTIONS[id] : undefined;
    return `Report: ${ctx.reportName}${description ? ` — ${description}` : ""}`;
  }
  if (ctx.path) return `Route ${ctx.path}`;
  return null;
}

// The report page's active text filter, if any, is user-typed search-box text:
// sanitized (single line, length-capped, no backticks) before it enters the
// prompt, then handed to the model as the tool's `filter` argument.
function reportToolGuidance(reportTool: string, ctx?: PageContext): string {
  const reportFilter = (ctx?.reportFilter ?? "").replace(/[`\r\n]+/g, " ").trim().slice(0, 100);
  const filtered = reportFilter
    ? ` The user has filtered this page to "${reportFilter}" — pass \`filter: "${reportFilter}"\` (adjusted to their question) so the answer matches what they see.`
    : "";
  return ` This report is backed by the \`${reportTool}\` tool — a one-call rollup of exactly this report's data. When the user asks about "this report", this page, or its contents, call \`${reportTool}\` to load it rather than reassembling the data from narrower tools. That tool takes a \`filter\` argument (same text matching as the page): pass one to scope large reports to the rows in question instead of pulling every row.${filtered}`;
}

export function currentPageSection(ctx?: PageContext): string {
  const page = pageContextLine(ctx);
  if (!page) return "";
  const reportTool = validReportTool(ctx);
  const guidance = reportTool ? reportToolGuidance(reportTool, ctx) : "";
  const subject = reportTool || ctx?.reportName ? "report" : "node";
  return `\n## Current page\nThe user is viewing: ${page}.${guidance} Treat references like "this", "here", or "this primitive" as that ${subject} unless they say otherwise.`;
}
