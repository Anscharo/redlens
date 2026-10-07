import { config } from "./config.ts";
import { getIndexes, resolveNode } from "./retrieval/indexes.ts";
import { renderOgTags, defaultOgTags, isUnknownRoute } from "./og.ts";
import { resolveOrigin } from "./reqOrigin.ts";
import { semanticLaneShown } from "./search-semantic.ts";

// Per-route values injected into dist/index.html: the live atlas sha (so the
// first artifact fetch hits the immutable /api/atlas/<sha>/ URL), OG/Twitter
// tags, and whether the route is a soft 404. Without loaded indexes it falls
// back to the site-level tags and an empty sha.
function pageContext(req: Request, pathname: string) {
  const url = new URL(req.url);
  const origin = resolveOrigin(req, url, config.appUrl);
  let ctx = { sha: "", ogTags: defaultOgTags(origin), notFound: false };
  try {
    const ix = getIndexes();
    const actor = (slug: string) => ix.entityBySlug.get(slug)?.name;
    const lookup = (idOrDocNo: string) => {
      const n = resolveNode(ix, idOrDocNo);
      return n ? { title: n.title, doc_no: n.doc_no, content: n.content } : undefined;
    };
    ctx = {
      sha: ix.meta.atlasCommit ?? "",
      notFound: isUnknownRoute(pathname, actor),
      ogTags: renderOgTags({ pathname, searchParams: url.searchParams, origin, lookup, actor }),
    };
  } catch {
    /* indexes not loaded yet — keep the site-level default */
  }
  return ctx;
}

// SPA fallback. An unknown dynamic route (e.g. /radar/<slug>) is a soft 404:
// the SPA HTML with a 404 status. Preview routes are noindex because their
// content is unreviewed; bare `/preview` counts, it is the first crawlable way in.
export async function serveSpaHtml(req: Request, pathname: string): Promise<Response> {
  const { sha, ogTags, notFound } = pageContext(req, pathname);
  // The server's real login capability, not the build-time VITE_USERS_ENABLED
  // (see src/lib/usersEnabled.ts).
  const html = (await Bun.file(config.distDir + "/index.html").text())
    .replace("{{ATLAS_SHA}}", sha)
    .replace("{{USERS_ENABLED}}", String(config.usersEnabled))
    .replace("{{CHAT_ENABLED}}", String(config.chatEnabled))
    .replace("{{AUTH_PROVIDERS}}", config.authProvidersCsv)
    .replace("{{SEMANTIC_SEARCH}}", String(semanticLaneShown()))
    .replace("{{OG_TAGS}}", ogTags);
  const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
  if (pathname === "/preview" || pathname.includes("/preview/")) headers["x-robots-tag"] = "noindex";
  return new Response(html, { status: notFound ? 404 : 200, headers });
}
