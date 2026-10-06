// The "Current page" section of the chat system prompt.
import { TOOLS_BY_NAME } from "./tools/tool-registry.ts";
import { REPORT_TITLES, REPORT_DESCRIPTIONS } from "../../lib/routes.ts";
import { decodeId } from "../preview/resolve.ts";

// reportName on the wire is the display title (REPORT_TITLES[id]), not the id.
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
  previewId?: string; // the PR preview the page is inside (its /preview/<id> segment)
  previewSha?: string; // that preview's built commit
}

// reportTool is a client hint: accept it only if it names a registered
// atlas_report_* tool, so a stray or hostile value can't steer the model.
export function validReportTool(ctx?: PageContext): string | null {
  const t = ctx?.reportTool;
  if (!t || !t.startsWith("atlas_report_")) return null;
  return TOOLS_BY_NAME.has(t) ? t : null;
}

// A preview id as /preview/<id> spells it: a sha, pull-N, owner:branch or
// owner:repo:branch with `~` for `/`. Checked before it is quoted into the
// prompt, so a hostile value cannot carry instructions. Display-only: the
// preview tools re-authorize on every call.
const PREVIEW_ID_RE = /^[\w.~:-]{1,200}$/;
const SHA_RE = /^[0-9a-f]{40}$/i;

export function validPreviewContext(ctx?: PageContext): { id: string; sha?: string } | null {
  const id = ctx?.previewId;
  if (!id || !PREVIEW_ID_RE.test(id) || !decodeId(id)) return null;
  return { id, ...(ctx?.previewSha && SHA_RE.test(ctx.previewSha) ? { sha: ctx.previewSha.toLowerCase() } : {}) };
}

function previewLine(p: { id: string; sha?: string }, ctx: PageContext): string {
  const commit = p.sha ? ` (commit ${p.sha.slice(0, 7)})` : "";
  const node = ctx.nodeId
    ? ` The open document is the preview's copy of "${ctx.nodeTitle ?? ctx.nodeId}"${ctx.nodeDocNo ? ` (${ctx.nodeDocNo})` : ""}, UUID ${ctx.nodeId}: read it with atlas_preview_get, not atlas_get.`
    : "";
  return `PR preview "${p.id}"${commit}: a PROPOSED Atlas, not the live one. "This PR" or "this change" means this preview: call atlas_preview_diff with preview_id "${p.id}".${node}`;
}

export function pageContextLine(ctx?: PageContext): string | null {
  if (!ctx) return null;
  const preview = validPreviewContext(ctx);
  if (preview) return previewLine(preview, ctx);
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

// reportFilter is user-typed: sanitized to one short backtick-free line.
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
  const subject = validPreviewContext(ctx) ? "PR" : reportTool || ctx?.reportName ? "report" : "node";
  return `\n## Current page\nThe user is viewing: ${page}.${guidance} Treat references like "this", "here", or "this primitive" as that ${subject} unless they say otherwise.`;
}
