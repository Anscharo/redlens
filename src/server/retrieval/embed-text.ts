// Single source of truth for what gets embedded and how EMBEDDING staleness is
// keyed. Both sync.ts (doc_meta.content_hash) and sync-embeddings.ts (embedding
// staleness) import these — a mismatch would silently re-embed everything or
// nothing, so keep them here and nowhere else.
//
// Embed text = title + link-stripped content. NO truncation: Qwen3's 32K context
// fits every atlas doc whole — measured 2026-08-17, the longest doc is 6,233 chars
// (~1.6K tokens, and ~3.1K even at a pessimistic 2 chars/token), so there is >10x
// headroom. That retires the long-node chunking concern; don't reopen it without
// new measurements.
//
// Markdown links are collapsed to their ANCHOR TEXT before embedding: 93% of the
// atlas's ~2,286 links target a bare doc UUID, and a 36-char hex string carries no
// semantic signal while costing tokens in the vector. Stripping happens HERE ONLY:
//   - never in the parser or docs.json — that would break cites/implements edge
//     extraction (graph-patterns.mjs UUID_LINK_RE), extractLinkedIds annotations,
//     and MarkdownLink SPA navigation;
//   - never for the lexical index — MiniSearch indexes raw content and quoted-URL
//     / partial-UUID queries match precisely because the targets are still there.
//
// contentHash excludes doc_no/parent/depth so a pure renumber doesn't churn
// embeddings, and (since the strip above) it no longer sees link targets either.
// It is deliberately INSENSITIVE because that is right for vectors — it is NOT a
// general "did this doc change" key. The change lane keys on the parser hash +
// title instead; see `changeKey` in atlas-refresh.ts.
import { createHash } from "node:crypto";
import { stripMarkdownLinks } from "../../lib/stripMarkdownLinks.ts";
import type { AtlasNode } from "./indexes.ts";

export function buildEmbedText(node: Pick<AtlasNode, "title" | "content">): string {
  // Strip before trim: collapsing a link can leave surrounding whitespace, and a
  // content field that is nothing but a link must reduce to the title alone.
  const content = stripMarkdownLinks(node.content ?? "").trim();
  return content ? `${node.title}\n\n${content}` : node.title;
}

export function contentHash(node: Pick<AtlasNode, "title" | "content">): string {
  return createHash("sha256").update(buildEmbedText(node)).digest("hex");
}
