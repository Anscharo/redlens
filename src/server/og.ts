// Server-side Open Graph / Twitter card injection for crawler link previews.
//
// Crawlers (Twitter/X, Slack, Discord, iMessage, LinkedIn, Facebook) don't run
// JS — they fetch the HTML once and read <meta> tags. So per-document previews
// have to live in the server-sent HTML, not in a client-side title update.
//
// The Bun SPA fallback (src/server/index.ts) already string-substitutes tokens
// into dist/index.html; this module produces the {{OG_TAGS}} block it injects.
// It renders for EVERY visitor (the tags are invisible to real users and the
// SPA ignores them) rather than sniffing user-agents — simpler and more robust.
//
// Query-string routing is intentional for now: the crawler-facing part is 100%
// about the meta tags, and the server sees the full URL either way. Atlas doc
// links are /atlas?id=<uuid|doc_no>; every other route gets the site default.

const SITE_NAME = "Sky Atlas by Redline";
const SITE_TITLE = "Sky Atlas by Redline";
const SITE_DESCRIPTION =
  "A search-first interface for the Sky ecosystem's next-gen atlas — documents, on-chain addresses, relationships, and history.";
const DEFAULT_IMAGE = "/icon-mid.png";
const DESCRIPTION_MAX = 200;

export interface OgDoc {
  title: string;
  doc_no: string;
  type: string;
  content: string;
}

export interface OgInput {
  pathname: string;
  searchParams: URLSearchParams;
  origin: string;
  // Resolve a ?id= value (UUID or doc_no) to a node, or undefined if unknown /
  // indexes not loaded. Kept as an injected fn so this stays pure + testable.
  lookup: (idOrDocNo: string) => OgDoc | undefined;
}

// Escape a string for safe interpolation into both HTML text and double-quoted
// attribute values. Covers the five chars that matter in either position.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Reduce atlas markdown to a one-line plain-text blurb for og:description.
// Not a full markdown parser — just enough to strip the noise a crawler would
// otherwise show verbatim (comments, link syntax, table pipes, fences).
export function plainSummary(content: string, max = DESCRIPTION_MAX): string {
  let s = content
    .replace(/<!--[\s\S]*?-->/g, " ") // HTML comments (UUID markers etc.)
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/^[>#\s|:-]+/gm, " ") // leading blockquote/heading/table markers
    .replace(/[`*_~|]/g, " ") // emphasis / code / table pipes
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return s;
}

function meta(property: string, content: string, attr: "property" | "name" = "property"): string {
  return `<meta ${attr}="${property}" content="${escapeHtml(content)}" />`;
}

// Build the full head block: one <title> plus og:* / twitter:* tags. Callers
// replace the {{OG_TAGS}} placeholder (which stands in for the <title>) with
// this, so there's always exactly one <title> element.
export function renderOgTags(input: OgInput): string {
  const { pathname, searchParams, origin, lookup } = input;

  let title = SITE_TITLE;
  let description = SITE_DESCRIPTION;
  let ogType = "website";
  let canonical = origin + pathname;

  if (pathname === "/atlas") {
    const id = searchParams.get("id");
    const doc = id ? lookup(id) : undefined;
    if (doc) {
      title = `${doc.title} · ${SITE_NAME}`;
      const context = [doc.doc_no, doc.type].filter(Boolean).join(" · ");
      const body = plainSummary(doc.content);
      description = body ? (context ? `${context} — ${body}` : body) : context || SITE_DESCRIPTION;
      ogType = "article";
      // Canonical keeps the id so shares resolve to this exact doc; other query
      // params (view/split) are dropped from the canonical URL.
      canonical = `${origin}/atlas?id=${encodeURIComponent(id!)}`;
    }
  }

  const image = origin + DEFAULT_IMAGE;

  return [
    `<title>${escapeHtml(title)}</title>`,
    meta("description", description, "name"),
    meta("og:site_name", SITE_NAME),
    meta("og:type", ogType),
    meta("og:title", title),
    meta("og:description", description),
    meta("og:url", canonical),
    meta("og:image", image),
    meta("twitter:card", "summary"),
    meta("twitter:title", title, "name"),
    meta("twitter:description", description, "name"),
    meta("twitter:image", image, "name"),
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
  ].join("\n    ");
}

// Convenience default used by the dev-server (Vite) path and by any request
// where the indexes aren't loaded yet — a bare site-level block, no doc lookup.
export function defaultOgTags(origin = ""): string {
  return renderOgTags({
    pathname: "/",
    searchParams: new URLSearchParams(),
    origin,
    lookup: () => undefined,
  });
}
