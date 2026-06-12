// Single source of truth for what gets embedded and how staleness is keyed.
// Both sync.ts (doc_meta.content_hash) and sync-embeddings.ts (embedding
// staleness) import these — a mismatch would silently re-embed everything or
// nothing, so keep them here and nowhere else.
//
// Embed text = title + content (matches build-rag's buildEmbedText). NO
// truncation: Qwen3's 32K context fits every atlas doc whole, which retires the
// long-node chunking concern. content_hash excludes doc_no/parent/depth so a
// pure renumber doesn't churn embeddings.
import { createHash } from "node:crypto";
import type { AtlasNode } from "./indexes.ts";

export function buildEmbedText(node: Pick<AtlasNode, "title" | "content">): string {
  const content = (node.content ?? "").trim();
  return content ? `${node.title}\n\n${content}` : node.title;
}

export function contentHash(node: Pick<AtlasNode, "title" | "content">): string {
  return createHash("sha256").update(buildEmbedText(node)).digest("hex");
}
