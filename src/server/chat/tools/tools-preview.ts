// The PR-preview tools: what is proposed for the Atlas but not merged yet.
// Spread into ATLAS_TOOLS, so chat and MCP both get them; what each caller may
// see is decided per call by preview/tool-access.ts from the ToolCallContext —
// MCP reads public, already-built canonical PR previews only, chat may build and
// may open a private repo its signed-in user is a collaborator on.
import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { AtlasTool } from "./tool-types.ts";
import type { ToolResult } from "./tools.ts";
import { fetchOpenPrs } from "../../preview/open-prs.ts";
import { bundleReady, readMeta } from "../../preview/cache.ts";
import { diffBaseLabel } from "../../preview/diff-base-record.ts";
import { openForTool, prContext } from "./tools-preview-common.ts";
import { ANON_MCP_CTX, type ToolCallContext } from "./tool-context.ts";
import { buildPreviewDiff, type PreviewDiffArgs } from "./tools-preview-diff.ts";
import { buildPreviewGet, type PreviewGetArgs } from "./tools-preview-get.ts";

// openWorldHint: the answer depends on GitHub's live PR state, not only the atlas.
const annotations = (title: string): ToolAnnotations => ({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  title,
});

const PREVIEW_ID = z
  .union([z.string(), z.number().int()])
  .describe(
    "Which preview: an open PR's number on sky-ecosystem/next-gen-atlas (412, '#412', 'pull-412' or its GitHub URL). " +
      "In chat, also any /preview id: 'owner:branch', 'owner:repo:pull-N', or a 40-hex sha.",
  );

function builtPreview(headSha: string) {
  const sha = headSha.toLowerCase();
  if (!sha || !bundleReady(sha)) return { built: false };
  const meta = readMeta(sha);
  if (!meta || meta.private) return { built: false };
  return { built: true, ...(meta.diffCounts ?? {}), base: diffBaseLabel(meta) ?? "live atlas" };
}

// What the model is told about an unbuilt preview depends on who is asking:
// chat's atlas_preview_diff builds one, MCP's never does (tool-access.ts).
const OPEN_PRS_NOTE: Record<ToolCallContext["surface"], string> = {
  chat:
    "Open PRs are proposals, not Atlas content. To explain or review one, call atlas_preview_diff with its preview_id: " +
    "it builds the preview if nobody has yet (preview.built=false), which can take up to a minute.",
  mcp:
    "Open PRs are proposals, not Atlas content. atlas_preview_diff reads a PR whose preview.built is true; an unbuilt one " +
    "is built by opening /preview/pull-N on the SAbR site.",
};

async function openPrs(a: Record<string, unknown>, ctx: ToolCallContext = ANON_MCP_CTX): Promise<ToolResult> {
  const all = await fetchOpenPrs();
  if (!all) return { source_class: "history", status: "unavailable", message: "GitHub did not answer the open-PR list. Try again shortly." };
  const prs = all.filter((p) => a.include_drafts !== false || !p.draft);
  const limit = (a.limit as number | undefined) ?? 30;
  return {
    source_class: "history",
    repo: "sky-ecosystem/next-gen-atlas",
    total: prs.length,
    prs: prs.slice(0, limit).map((p) => ({
      number: p.number,
      title: p.title,
      author: p.author,
      draft: p.draft,
      updated_at: p.updatedAt,
      url: p.url,
      preview_id: `pull-${p.number}`,
      preview: builtPreview(p.headSha),
    })),
    note: OPEN_PRS_NOTE[ctx.surface],
  };
}

export const PREVIEW_TOOLS: AtlasTool[] = [
  {
    name: "atlas_open_prs",
    whenToUse:
      "The question is about what is coming: upcoming, pending or proposed Atlas changes, open PRs, 'what's on the horizon'. Not for merged history (atlas_recent_changes).",
    annotations: annotations("Atlas Open PRs"),
    description:
      "Open (unmerged) pull requests against sky-ecosystem/next-gen-atlas, most recently updated first: number, title, " +
      "author, draft flag, URL, and — when a preview of it has been built — how many documents it adds and changes.",
    shape: {
      include_drafts: z.boolean().optional().default(true).describe("Include draft PRs (default true)."),
      limit: z.number().int().min(1).max(100).optional().default(30),
    },
    handler: (_ix, a, ctx) => openPrs(a, ctx),
  },
  {
    name: "atlas_preview_diff",
    whenToUse:
      "The question is about an UNMERGED change — review this PR, what would PR #N change, which documents does this proposal touch. For a merged PR use atlas_pr.",
    annotations: annotations("Atlas Preview Diff"),
    description:
      "What a PR preview adds, changes and removes in the Atlas, against the base its redline uses (the PR's own base " +
      "branch, or the live Atlas). Returns the PR (with its GitHub description) and base, counts, and a page of documents " +
      "sorted by doc_no, each with its doc_no, title, type, parent, renumber/retitle flags, a short patch, and a `cite` " +
      "link. In chat it builds a preview nobody has built yet; if the build fails it still returns the PR's description.",
    shape: {
      preview_id: PREVIEW_ID,
      change: z.enum(["added", "changed", "removed"]).optional().describe("Only this kind of change."),
      offset: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(100).optional().default(40),
      patch_lines: z.number().int().min(0).max(40).optional().default(12).describe("Patch lines per document (0 for none)."),
    },
    emptyArgsAbsent: true,
    handler: async (ix, a, ctx) => {
      const o = await openForTool(a.preview_id, ctx);
      if ("result" in o) return o.result;
      const pr = await prContext(o.open.id);
      return { ...buildPreviewDiff(ix, o.open, a as unknown as PreviewDiffArgs), ...(pr ? { pr_description: pr.description } : {}) };
    },
  },
  {
    name: "atlas_preview_get",
    whenToUse:
      "You need the full proposed text of documents in an unmerged PR — to review it closely or to check it reads like similar live documents (then fetch those with atlas_filter / atlas_get).",
    annotations: annotations("Atlas Preview Get"),
    description:
      "Full text of up to 5 documents as a PR preview has them (by uuid or the preview's doc_no), with each one's " +
      "change status, parent and ancestors, the live Atlas's text of the same document for comparison, its patch, " +
      "and optionally its children.",
    shape: {
      preview_id: PREVIEW_ID,
      ids: z.array(z.string()).min(1).max(5).describe("UUIDs or doc_nos as numbered in the preview."),
      include_base: z.boolean().optional().default(true).describe("Include the live Atlas's text of each document (default true)."),
      include_children: z.boolean().optional().default(false),
    },
    handler: async (ix, a, ctx) => {
      const o = await openForTool(a.preview_id, ctx);
      return "result" in o ? o.result : buildPreviewGet(ix, o.open, a as unknown as PreviewGetArgs);
    },
  },
];
