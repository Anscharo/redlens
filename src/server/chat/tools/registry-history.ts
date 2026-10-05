// History tools: one document's change log, recent changes across the atlas,
// aggregated timelines, one PR's footprint, and the diff between two commits.
// Assembled into ATLAS_TOOLS by tool-registry.ts.
//
// Every tool here with an optional `change_type` enum sets emptyArgsAbsent: a
// model that fills every declared property has no empty value for an optional
// enum, so it writes a real change_type nobody asked for. With the flag, `null`
// and "" read as unset.
import { z } from "zod";
import { atlasHistory, atlasRecentChanges, atlasHistoryStats, atlasPr, atlasChangedBetween } from "./tools-history.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";

const CHANGE_TYPE = () => z.enum(["added", "modified", "removed", "moved"]).optional();

export const HISTORY_TOOLS: AtlasTool[] = [
  {
    name: "atlas_history",
    whenToUse:
      "The question is why or when ONE specific document changed.",
    annotations: readOnlyAtlasTool("Atlas History"),
    description: "Why was this changed? Returns the change log for one Atlas doc, newest first — git commits (with PR title/author/url and matched summary/description) plus, for docs old enough, reconstructed pre-git origin events: era='mip' (verbiage traced to the pre-2024 MIP-era Atlas), 'genesis' (present in the Atlas v2 launch snapshot, 2024-09-02), or 'severed' (an undated birth in the git-less window before 2025-05-28). Reconstructed rows have no real commit_sha — check `era` before treating `commit_sha` as a GitHub commit. Filter by date range, PR number, or change type.",
    shape: {
      id: z.string().describe("Doc UUID or doc_no."),
      since: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      pr: z.number().int().optional().describe("Filter to a single PR number."),
      change_type: CHANGE_TYPE(),
      with_diff: z.boolean().default(false).describe("Include line+word diffs in the response."),
    },
    handler: (ix, a) => atlasHistory(ix, a.id as string, a as Parameters<typeof atlasHistory>[2]),
    emptyArgsAbsent: true,
  },
  {
    name: "atlas_recent_changes",
    whenToUse:
      "The question is 'what changed recently' across the atlas, with no specific document in mind.",
    annotations: readOnlyAtlasTool("Atlas Recent Changes"),
    description: "What changed recently? Returns the most recent change events across the whole atlas, optionally filtered by doc type, change type, or entity. Defaults to the last 30 days.",
    shape: {
      since: z.string().optional().describe("ISO date. Defaults to 30 days ago."),
      until: z.string().optional(),
      type: z.string().optional().describe("Atlas doc type filter."),
      change_type: CHANGE_TYPE(),
      entity: z.string().optional().describe("Entity slug — restricts to docs linked via responsible_party_for / active_data_for."),
      k: z.number().int().min(1).max(200).default(50),
    },
    handler: (ix, a) => atlasRecentChanges(ix, a as Parameters<typeof atlasRecentChanges>[1]),
    emptyArgsAbsent: true,
  },
  {
    name: "atlas_history_stats",
    whenToUse:
      "Trend, timeline, quarterly, or coverage-window questions — use aggregated history instead of paging raw atlas_history events.",
    annotations: readOnlyAtlasTool("Atlas History Stats"),
    description:
      "Summarize Atlas history by month or quarter, with global availability bounds, change-type counts, optional " +
      "grouping, top changed docs, and top PRs. Counts mix git-derived events with reconstructed ones " +
      "(era='html' has real commits/PRs but per-doc deltas rebuilt from archived HTML; era='mip'/'genesis'/'severed' " +
      "predate the repo entirely) — group_by 'era' to split them, and read the response `warnings` before " +
      "describing a bucket as editorial activity.",
    shape: {
      since: z.string().optional().describe("ISO date (YYYY-MM-DD). If earlier than available history, the response includes a warning."),
      until: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
      bucket: z.enum(["month", "quarter"]).default("month"),
      group_by: z
        .array(z.enum(["doc_type", "scope", "change_kind", "review_status", "pr_author", "era"]))
        .max(6)
        .default([])
        .describe(
          "Optional grouping dimensions to include inside each bucket. 'era' splits reconstructed history " +
            "from git-derived history (git | html | mip | genesis | severed).",
        ),
      include_top_docs: z.boolean().default(false),
      include_prs: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20).describe("Max top docs / PRs to return."),
    },
    handler: (ix, a) =>
      atlasHistoryStats(ix, {
        since: a.since as string | undefined,
        until: a.until as string | undefined,
        bucket: (a.bucket as "month" | "quarter" | undefined) ?? "month",
        group_by: (a.group_by as Parameters<typeof atlasHistoryStats>[1]["group_by"] | undefined) ?? [],
        include_top_docs: (a.include_top_docs as boolean | undefined) ?? false,
        include_prs: (a.include_prs as boolean | undefined) ?? false,
        limit: (a.limit as number | undefined) ?? 20,
      }),
  },
  {
    name: "atlas_pr",
    whenToUse:
      "The question names a specific GitHub PR number and asks what it touched.",
    annotations: readOnlyAtlasTool("Atlas PR"),
    description: "What did PR #N touch? Returns every doc affected by a single GitHub PR against next-gen-atlas, with per-doc summary/description from the PR body.",
    shape: {
      pr_number: z.number().int().describe("GitHub PR number on sky-ecosystem/next-gen-atlas."),
    },
    handler: (ix, a) => atlasPr(ix, a.pr_number as number),
  },
  {
    name: "atlas_changed_between",
    whenToUse:
      "The question compares two atlas versions — what changed between two commits/SHAs.",
    annotations: readOnlyAtlasTool("Atlas Changed Between"),
    description: "Which docs changed between two atlas commits? Pass two short SHAs and get every doc added/modified/moved/removed in that window. Uses commit_seq for exact topological ordering.",
    shape: {
      commit_a: z.string().describe("First boundary commit SHA (7-char prefix or full)."),
      commit_b: z.string().describe("Second boundary commit SHA."),
      change_type: CHANGE_TYPE(),
      ancestor_id: z.string().optional().describe("Restrict results to descendants of this node."),
      entity: z.string().optional().describe("Restrict to docs linked to this entity."),
      limit: z.number().int().min(1).max(500).default(100),
    },
    handler: (ix, a) => atlasChangedBetween(ix, a as Parameters<typeof atlasChangedBetween>[1]),
    emptyArgsAbsent: true,
  },
];
