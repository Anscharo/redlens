// Allowlisted Sky Forum cycle series. We never crawl the whole forum — only
// patterned update threads (settlement reports, atlas-edit proposals, spell
// change posts). Adding a series is a new entry here plus a Discourse tag
// (or title pattern) the worker already knows how to fetch.
//
// `kind` is the DB/API value (msc, aec, spell). `slug` names the series.

export const FORUM_ORIGIN = "https://forum.skyeco.com";

export type ForumKind = "msc" | "aec" | "spell";

export interface ForumCycle {
  kind: ForumKind;
  slug: string;
  title: string;
  /** Atlas document that defines the cycle. */
  atlasDocId: string;
  /** Discourse tag slug; worker fetches `/tag/<forumTag>.json`. */
  forumTag: string;
  forumTagUrl: string;
  /** Title regex used as a safety-net classifier (in addition to the tag). */
  titlePattern: RegExp;
}

export const FORUM_CYCLES: readonly ForumCycle[] = [
  {
    kind: "msc",
    slug: "monthly-settlement-cycle",
    title: "Monthly Settlement Cycle",
    // A.2.4 Sky Core Monthly Settlement Cycle
    atlasDocId: "6f8d5065-d6ff-4add-9a28-eadeffa7ed1a",
    forumTag: "monthly-settlement-cycle",
    forumTagUrl: `${FORUM_ORIGIN}/tag/monthly-settlement-cycle/1493`,
    titlePattern: /\b(monthly settlement cycle|msc\s*#?\d+)\b/i,
  },
];

export const FORUM_CYCLE_BY_KIND: ReadonlyMap<ForumKind, ForumCycle> = new Map(
  FORUM_CYCLES.map((c) => [c.kind, c]),
);

export function isForumKind(value: string): value is ForumKind {
  return FORUM_CYCLE_BY_KIND.has(value as ForumKind);
}

/** Pull Discourse tag slugs out of either `["msc"]` or `[{ slug: "msc" }]`. */
export function tagSlugs(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t === "string" && t) out.push(t);
    else if (t && typeof t === "object" && "slug" in t && typeof (t as { slug: unknown }).slug === "string") {
      out.push((t as { slug: string }).slug);
    } else if (t && typeof t === "object" && "name" in t && typeof (t as { name: unknown }).name === "string") {
      out.push((t as { name: string }).name);
    }
  }
  return out;
}

export function classifyForumTopic(tags: unknown, title: string): ForumKind | null {
  const slugs = tagSlugs(tags);
  for (const cycle of FORUM_CYCLES) {
    if (slugs.includes(cycle.forumTag)) return cycle.kind;
  }
  for (const cycle of FORUM_CYCLES) {
    if (cycle.titlePattern.test(title)) return cycle.kind;
  }
  return null;
}

// Vectors: do not generate them for MSC summaries or weekly atlas-edit
// wrappers (decided 2026-08-25). Those posts share a template — month, USDS
// amounts, and edit bullets are structured — so cosine search would cluster
// every cycle together. Chat/MCP should use period + title (+ settlements.json
// / the atlas) instead. forum_embeddings.embedding stays NULL.
// Revisit only for the rare non-templated threads (reconciliations,
// technical-scope, out-of-schedule diffs). If that allowlist ships: topic =
// title + OP; post = a reply ≥ 200 stripped chars; never sentences.
export const FORUM_EMBED_ENABLED = false;
export const FORUM_EMBED_GRAINS = ["topic", "post"] as const;

/** Replies shorter than this (stripped text) are not worth their own vector. */
export const FORUM_POST_EMBED_MIN_CHARS = 200;

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldEmbedPost(stripped: string): boolean {
  return stripped.length >= FORUM_POST_EMBED_MIN_CHARS;
}

export function topicEmbedText(title: string, opBody: string): string {
  return `${title}\n\n${opBody}`.trim();
}
