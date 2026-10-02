// The page the user is on when they ask, as the client reports it, and the one
// line of system prompt it becomes. Every field is client-supplied: it steers
// the model only, never access — the preview tools re-authorize on every call.
import { TOOLS_BY_NAME } from "./tools/tool-registry.ts";
import { REPORT_TITLES, REPORT_DESCRIPTIONS } from "../../lib/routes.ts";
import { decodeId } from "../preview/resolve.ts";

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
  previewId?: string; // the PR preview the page is inside (its /preview/<id> segment)
  previewSha?: string; // that preview's built commit
}

// The client sends reportTool as a hint; never trust it verbatim in the prompt.
// Accept it only if it names a real, registered atlas_report_* tool — otherwise
// a stray/renamed/hostile value can't steer the model at a non-existent tool.
export function validReportTool(ctx?: PageContext): string | null {
  const t = ctx?.reportTool;
  if (!t || !t.startsWith("atlas_report_")) return null;
  return TOOLS_BY_NAME.has(t) ? t : null;
}

// A preview id as /preview/<id> spells it: a sha, pull-N, owner:branch or
// owner:repo:branch with `~` for `/`. Checked before it is quoted into the
// prompt, so a hostile value cannot carry instructions.
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
