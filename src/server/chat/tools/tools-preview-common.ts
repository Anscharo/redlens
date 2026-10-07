// Shared pieces of the preview tools' results (tools-preview*.ts).
import type { ToolResult } from "./tools.ts";
import type { ToolCallContext } from "./tool-context.ts";
import type { PreviewMeta } from "../../preview/cache.ts";
import { diffBaseLabel } from "../../preview/diff-base-record.ts";
import { admitPrivate, openPreviewForTool, type ToolOpen } from "../../preview/tool-access.ts";
import { fetchOpenPrs } from "../../preview/open-prs.ts";
import { CANONICAL_REPO, decodeId } from "../../preview/resolve.ts";

// Leads every result so it survives budget truncation: the verifier reads it to
// treat the text as a proposal rather than the live Atlas (verify/preview-evidence.ts).
export const PREVIEW_SOURCE_CLASS = "preview";

export const CITATION_NOTE =
  "This is PROPOSED text from a PR preview, not the live Atlas. Cite a preview document with its `cite` link " +
  "([title](/preview/<sha>/atlas?id=<uuid>)), never /atlas/<uuid> — an added document does not exist in the live Atlas. " +
  "Cite live documents (removed ones, or live siblings you compare against) with /atlas/<uuid> as usual.";

export function previewHeader(meta: PreviewMeta, id: string) {
  return {
    id,
    sha: meta.sha,
    repo: meta.repo,
    ref: meta.ref,
    kind: meta.kind,
    pr: meta.prNumber ? { number: meta.prNumber, title: meta.prTitle ?? "", author: meta.prAuthor ?? "", state: meta.prState ?? "open" } : null,
    private: !!meta.private,
    head_commit_at: meta.headCommitAt ?? null,
    doc_count: meta.docCount,
    base: { auto: meta.bases?.auto ?? null, reason: meta.bases?.reason ?? null, label: diffBaseLabel(meta) ?? "live atlas" },
    ...(meta.trustTier ? { trust_tier: meta.trustTier } : {}),
    ...(meta.newAddresses ? { new_addresses: meta.newAddresses } : {}),
    ...(meta.addressCheckFailed ? { address_check_failed: true } : {}),
  };
}

// The tail of a not-ready message: what the model explains the PR from.
const explainFrom = (hasPr: boolean) =>
  hasPr ? "Explain the PR from its description (pr_description)" : "Its description is not available here; say so rather than guess what it proposes";

type NotReady = Exclude<ToolOpen["status"], "ready">;
const NOT_READY: Record<NotReady, (o: ToolOpen, surface: string, hasPr: boolean) => string> = {
  building: (_o, _s, hasPr) =>
    `The preview is still building. ${explainFrom(hasPr)} meanwhile, and tell the user the document-level changes follow if they ask again in a minute.`,
  "not-built": (o, _s, hasPr) =>
    `No preview of ${o.id} has been built yet, and this caller cannot build one. ${explainFrom(hasPr)}; opening /preview/${o.id} on the SAbR site builds the preview.`,
  failed: (o, _s, hasPr) =>
    `The preview build failed (${"code" in o ? o.code : "build-failed"}; build_error has the builder's message when there is one). ${explainFrom(hasPr)}, and say its document-level changes could not be read.`,
  "not-found": (_o, surface) =>
    surface === "mcp"
      ? "No open PR on sky-ecosystem/next-gen-atlas with a public preview matches that id. Pass an open PR's number (see atlas_open_prs)."
      : "No preview matches that id, or the signed-in user cannot see it. Pass a PR number, a PR URL, or a preview id.",
  unavailable: () => "GitHub did not answer (the PR list or the access check). Try again shortly.",
  "rate-limited": () => "Too many preview builds requested — try again shortly.",
};

// Statuses whose PR may still be explained from GitHub. `unavailable` means
// GitHub just failed to answer, so asking it again only adds latency.
const EXPLAINABLE = new Set<NotReady>(["building", "not-built", "failed"]);

export function notReadyResult(open: Exclude<ToolOpen, { status: "ready" }>, surface: string, pr: PrContext | null): ToolResult {
  return {
    source_class: PREVIEW_SOURCE_CLASS,
    status: open.status,
    preview_id: open.id,
    message: NOT_READY[open.status](open, surface, !!pr),
    ...(pr ?? {}),
    ...("detail" in open && open.detail ? { build_error: open.detail } : {}),
  };
}

/** Opens the preview a tool call names, or returns the result to hand the model instead. */
export async function openForTool(
  rawId: unknown,
  ctx: ToolCallContext | undefined,
): Promise<{ open: Extract<ToolOpen, { status: "ready" }> } | { result: ToolResult }> {
  const c = ctx ?? { surface: "mcp" as const };
  const open = await openPreviewForTool(rawId, c);
  if (open.status !== "ready") {
    const pr = EXPLAINABLE.has(open.status) ? await prContext(decodedPrNumber(open.id)) : null;
    return { result: notReadyResult(open, c.surface, pr) };
  }
  if (!(await admitPrivate(c, open.meta))) {
    return { result: { source_class: PREVIEW_SOURCE_CLASS, status: "not-found", preview_id: open.id, message: NOT_READY["not-found"](open, c.surface, false) } };
  }
  return { open };
}

function decodedPrNumber(id: string): number | null {
  const parsed = decodeId(id);
  return parsed?.kind === "pr" ? parsed.prNumber : null;
}

/** The canonical PR a ready preview was built from, read from its own meta. */
export function metaPrNumber(meta: PreviewMeta): number | null {
  return meta.kind === "pr" && meta.repo.toLowerCase() === CANONICAL_REPO && meta.prNumber ? meta.prNumber : null;
}

export type PrContext = NonNullable<Awaited<ReturnType<typeof prContext>>>;

/** An open canonical PR's GitHub title, author and description, so a question
 *  about it has an answer even when its preview cannot be read. The description
 *  is the author's account of the change, not Atlas text: it travels under
 *  `pr_description`, which the verifier never counts as preview evidence
 *  (verify/preview-evidence.ts). Null for anything else. */
export async function prContext(prNumber: number | null) {
  if (prNumber === null) return null;
  const pr = (await fetchOpenPrs().catch(() => null))?.find((p) => p.number === prNumber);
  if (!pr) return null;
  return {
    pr: { number: pr.number, title: pr.title, author: pr.author, draft: pr.draft, url: pr.url },
    pr_description: pr.body,
    pr_description_is: "the PR author's own words, not Atlas text",
  };
}

/** A ready diff with its PR's description right after the header, so a large
 *  diff's budget truncation keeps it. The diff passes it only on its first page. */
export function withPrDescription(r: ToolResult, pr: PrContext | null): ToolResult {
  if (!pr) return r;
  const { source_class, preview } = r as Record<string, unknown>;
  return { source_class, preview, pr_description: pr.pr_description, pr_description_is: pr.pr_description_is, ...r };
}

export const byDocNo = (a: { doc_no: string }, b: { doc_no: string }) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true });
