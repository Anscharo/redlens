// The open pull requests against the atlas (GET /api/preview/open-prs, cached
// on the server), for the on-chain steps: an open PR that names a spell is the
// atlas update recording it (src/lib/pauChainLed.ts). Resolves to [] when the
// list cannot be read, and is asked again next time.
import type { OpenAtlasPr } from "@/lib/pauChainLed";

let cached: Promise<OpenAtlasPr[]> | null = null;

export function loadOpenAtlasPrs(): Promise<OpenAtlasPr[]> {
  cached ??= fetch(`${import.meta.env.BASE_URL}api/preview/open-prs`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d: unknown) => (Array.isArray(d) ? (d as OpenAtlasPr[]) : []))
    .catch(() => {
      cached = null;
      return [];
    });
  return cached;
}
