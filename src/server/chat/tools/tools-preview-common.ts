// Shared pieces of the preview tools' results (tools-preview*.ts).
import type { ToolResult } from "./tools.ts";
import type { ToolCallContext } from "./tool-context.ts";
import type { PreviewMeta } from "../../preview/cache.ts";
import { diffBaseLabel } from "../../preview/diff-base-record.ts";
import { admitPrivate, openPreviewForTool, type ToolOpen } from "../../preview/tool-access.ts";

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

const NOT_READY: Record<Exclude<ToolOpen["status"], "ready">, (o: ToolOpen, surface: string) => string> = {
  building: () => "The preview is still building. Tell the user it is on its way and to ask again in a minute.",
  "not-built": (o) =>
    `No preview of ${o.id} has been built yet. Opening /preview/${o.id} on the SAbR site builds it; the chat on that site can build it too.`,
  failed: (o) => `The preview build failed (${"code" in o ? o.code : "build-failed"}).`,
  "not-found": (_o, surface) =>
    surface === "mcp"
      ? "No open PR on sky-ecosystem/next-gen-atlas with a public preview matches that id. Pass an open PR's number (see atlas_open_prs)."
      : "No preview matches that id, or the signed-in user cannot see it. Pass a PR number, a PR URL, or a preview id.",
  unavailable: () => "GitHub did not answer (the PR list or the access check). Try again shortly.",
  "rate-limited": () => "Too many preview builds requested — try again shortly.",
};

/** Opens the preview a tool call names, or returns the result to hand the model instead. */
export async function openForTool(
  rawId: unknown,
  ctx: ToolCallContext | undefined,
): Promise<{ open: Extract<ToolOpen, { status: "ready" }> } | { result: ToolResult }> {
  const c = ctx ?? { surface: "mcp" as const };
  const open = await openPreviewForTool(rawId, c);
  if (open.status !== "ready") return { result: { source_class: PREVIEW_SOURCE_CLASS, status: open.status, preview_id: open.id, message: NOT_READY[open.status](open, c.surface) } };
  if (!(await admitPrivate(c, open.meta))) {
    return { result: { source_class: PREVIEW_SOURCE_CLASS, status: "not-found", preview_id: open.id, message: NOT_READY["not-found"](open, c.surface) } };
  }
  return { open };
}

export const byDocNo = (a: { doc_no: string }, b: { doc_no: string }) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true });
