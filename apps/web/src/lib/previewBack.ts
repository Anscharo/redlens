// Where the preview index's "← back" link goes: the page the visitor arrived
// from, when that page is this app — the live atlas or a preview, which are
// both full page loads into /preview, so document.referrer carries their exact
// path. A referrer from another site, from outside the app's base, or from the
// index itself (a reload) falls back to the live atlas root.

export function previewBackHref(referrer: string, origin: string, base: string): string {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return base;
  }
  if (url.origin !== origin) return base;
  const baseNoSlash = base.replace(/\/$/, "");
  if (!`${url.pathname}/`.startsWith(`${baseNoSlash}/`)) return base;
  if (url.pathname.replace(/\/$/, "") === `${baseNoSlash}/preview`) return base;
  return url.pathname + url.search + url.hash;
}
