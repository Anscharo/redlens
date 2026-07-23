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
// links are /atlas?id=<uuid|doc_no>; other routes get their own card too.

import { ROUTES, REPORT_TITLES } from "../lib/routes.ts";

const SITE_NAME = "Sky Atlas by Redline";
const SITE_TITLE = "Sky Atlas by Redline";
const SITE_DESCRIPTION =
  "A search-first interface for the Sky ecosystem's next-gen atlas — documents, on-chain addresses, relationships, and history.";
// og:description hard cap, measured on the whole string INCLUDING the
// "<doc_no> — " prefix. The description ends at the first sentence or this
// many characters, whichever comes first.
const DESCRIPTION_MAX = 140;

export interface OgDoc {
  title: string;
  doc_no: string;
  content: string;
}

export interface OgInput {
  pathname: string;
  searchParams: URLSearchParams;
  origin: string;
  // Resolve a ?id= value (UUID or doc_no) to a node, or undefined if unknown /
  // indexes not loaded. Kept as injected fns so this stays pure + testable.
  lookup: (idOrDocNo: string) => OgDoc | undefined;
  // Resolve a radar actor slug to its display name (undefined → de-slugified).
  actor?: (slug: string) => string | undefined;
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

// Build the og:description as "<doc_no> — <body>", ending at the first sentence
// or DESCRIPTION_MAX characters (measured on the whole string, prefix included),
// whichever comes first. Sentence detection runs on `body` only, so periods
// inside the doc number (e.g. "A.2.2.8.1") don't count as sentence ends.
export function clampDescription(docNo: string, body: string, max = DESCRIPTION_MAX): string {
  const text = body.trim();
  if (!text) return docNo || SITE_DESCRIPTION;
  const prefix = `${docNo} — `;
  // First sentence: up to and including the first . ! or ? at a word/line end.
  const m = text.match(/[.!?](?=\s|$)/);
  const firstSentence = m ? text.slice(0, m.index! + 1) : text;
  const candidate = prefix + firstSentence;
  if (candidate.length <= max) return candidate;
  // 140 comes first (or the first sentence runs past it): hard-cap on a word
  // boundary with an ellipsis.
  return (prefix + text).slice(0, max).replace(/\s+\S*$/, "").trimEnd() + "…";
}

function meta(property: string, content: string, attr: "property" | "name" = "property"): string {
  return `<meta ${attr}="${property}" content="${escapeHtml(content)}" />`;
}

interface RouteDesc {
  title: string;
  description: string;
  ogType: string;
  canonical: string;
  image: string; // absolute og:image URL (a generated 1200×630 card)
}

const ogCardUrl = (origin: string, query: string) => `${origin}/api/og.png?${query}`;

// "op-facilitators" → "Op Facilitators". Fallback actor label when the slug
// can't be resolved to a real display name.
function deslug(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map a request (path + query) to its card + meta text. Every route resolves to
// a generated 1200×630 card; unmatched routes get the site-default wordmark.
function describeRoute(input: OgInput): RouteDesc {
  const { searchParams, origin, lookup, actor } = input;
  const canonical = origin + input.pathname;

  // Preview prefix: /preview/<id>/<inner…>. Peel it off so the inner route still
  // gets its own card, marked as a preview.
  let previewLabel = "";
  let pathname = input.pathname;
  if (pathname.startsWith("/preview/")) {
    const rest = pathname.slice("/preview/".length);
    const slash = rest.indexOf("/");
    const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
    previewLabel = /^\d+$/.test(id) ? `PR #${id}` : id;
    pathname = slash === -1 ? "/" : rest.slice(slash);
  }

  // Atlas document (live, or a doc viewed inside a preview).
  if (pathname === ROUTES.ATLAS) {
    const id = searchParams.get("id");
    const doc = id ? lookup(id) : undefined;
    if (doc) {
      const title = `${previewLabel ? "Preview · " : ""}${doc.title} · ${SITE_NAME}`;
      const description = clampDescription(doc.doc_no, plainSummary(doc.content, Number.POSITIVE_INFINITY));
      const image = previewLabel
        ? `${origin}/api/og/${encodeURIComponent(id!)}.png?preview=${encodeURIComponent(previewLabel)}`
        : `${origin}/api/og/${encodeURIComponent(id!)}.png`;
      // Live docs canonicalize to the bare doc URL; preview docs keep their URL.
      return { title, description, ogType: "article", canonical: previewLabel ? canonical : `${origin}/atlas?id=${encodeURIComponent(id!)}`, image };
    }
  }

  // Preview landing (or a preview whose inner route isn't a resolvable doc).
  if (previewLabel) {
    return {
      title: `Previewing ${previewLabel} · Sky Atlas`,
      description: `Previewing a proposed change to the Sky Atlas (${previewLabel}).`,
      ogType: "website",
      canonical,
      image: ogCardUrl(origin, `kind=preview&label=${encodeURIComponent(previewLabel)}`),
    };
  }

  // Radar actor page.
  if (pathname.startsWith(`${ROUTES.RADAR}/`)) {
    const slug = decodeURIComponent(pathname.slice(ROUTES.RADAR.length + 1).split("/")[0]);
    const agent = actor?.(slug) || deslug(slug);
    return {
      title: `${agent} · Radar · Sky Atlas`,
      description: `${agent} on the Sky Atlas radar — chain, responsibilities, instances, and governance relationships.`,
      ogType: "profile",
      canonical,
      image: ogCardUrl(origin, `kind=radar-actor&name=${encodeURIComponent(agent)}`),
    };
  }
  if (pathname === ROUTES.RADAR) {
    return {
      title: "Radar · Sky Atlas by Redline",
      description: "Entity-focused view of the Sky ecosystem — agents, their responsibilities, and governance relationships.",
      ogType: "website",
      canonical,
      image: ogCardUrl(origin, "kind=radar"),
    };
  }

  // A specific report (named slug), else the reports index.
  if (pathname.startsWith(`${ROUTES.REPORTS}/`)) {
    const slug = pathname.slice(ROUTES.REPORTS.length + 1).split("/")[0];
    const name = REPORT_TITLES[slug];
    if (name) {
      return {
        title: `${name} · Sky Atlas Reports`,
        description: `${name} — a structured report over the Sky Atlas.`,
        ogType: "website",
        canonical,
        image: ogCardUrl(origin, `kind=report&name=${encodeURIComponent(name)}`),
      };
    }
  }
  if (pathname === ROUTES.REPORTS || pathname.startsWith(`${ROUTES.REPORTS}/`)) {
    return {
      title: "Reports · Sky Atlas by Redline",
      description: "Structured reports over the Sky Atlas — responsibilities, active data, rewards, processes, and more.",
      ogType: "website",
      canonical,
      image: ogCardUrl(origin, "kind=reports"),
    };
  }

  // Connect (MCP) page.
  if (pathname === ROUTES.CONNECT) {
    return {
      title: "Connect · Sky Atlas by Redline",
      description: "Connect to the Redline Sky Atlas MCP server.",
      ogType: "website",
      canonical,
      image: ogCardUrl(origin, "kind=connect"),
    };
  }

  // Everything else: the site-default wordmark card.
  return { title: SITE_TITLE, description: SITE_DESCRIPTION, ogType: "website", canonical, image: ogCardUrl(origin, "kind=default") };
}

// Build the full head block: one <title> plus og:* / twitter:* tags. Callers
// replace the {{OG_TAGS}} placeholder (which stands in for the <title>) with
// this, so there's always exactly one <title> element. Every route resolves to
// a generated 1200×630 card, so the dimensions are always emitted.
export function renderOgTags(input: OgInput): string {
  const d = describeRoute(input);
  return [
    `<title>${escapeHtml(d.title)}</title>`,
    meta("description", d.description, "name"),
    meta("og:site_name", SITE_NAME),
    meta("og:type", d.ogType),
    meta("og:title", d.title),
    meta("og:description", d.description),
    meta("og:url", d.canonical),
    meta("og:image", d.image),
    meta("og:image:width", "1200"),
    meta("og:image:height", "630"),
    meta("twitter:card", "summary_large_image", "name"),
    meta("twitter:title", d.title, "name"),
    meta("twitter:description", d.description, "name"),
    meta("twitter:image", d.image, "name"),
    `<link rel="canonical" href="${escapeHtml(d.canonical)}" />`,
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
