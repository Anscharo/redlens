import { config } from "./config.ts";
import { NOT_FOUND } from "./http.ts";
import { getIndexes, resolveNode } from "./retrieval/indexes.ts";
import { getOgImage, getCardImage, cardFromQuery } from "./og-image.ts";

// Generated OG card images, both memoized by og-image.ts:
//   /api/og/<uuid|doc_no>.png[?preview=<label>] — a document card
//   /api/og.png?kind=…                          — a route card built from query params
// Any miss falls back to the static site icon so og:image always resolves.
const OG_HEADERS = { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" };

export async function ogFallback(): Promise<Response> {
  const fallback = Bun.file(config.distDir + "/icon-mid.png");
  if (await fallback.exists()) return new Response(fallback, { headers: OG_HEADERS });
  return NOT_FOUND();
}

export async function handleOgImage(url: URL): Promise<Response> {
  const idOrDocNo = decodeURIComponent(url.pathname.slice("/api/og/".length).replace(/\.png$/, ""));
  const preview = url.searchParams.get("preview") ?? "";
  let png: Buffer | null = null;
  try {
    const node = resolveNode(getIndexes(), idOrDocNo);
    if (node) png = await getOgImage(node.id, node.title, node.doc_no, preview);
  } catch {
    /* indexes not loaded yet — fall through to the static fallback */
  }
  return png ? new Response(png, { headers: OG_HEADERS }) : ogFallback();
}

export async function handleOgCard(url: URL): Promise<Response> {
  const png = await getCardImage(cardFromQuery(url.searchParams));
  return png ? new Response(png, { headers: OG_HEADERS }) : ogFallback();
}
