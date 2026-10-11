import { useEffect, useState } from "react";
import type { PreviewMeta } from "./previewMetaTypes";

// The one reader of a preview bundle's meta.json. Every preview surface (banner,
// interstitial, history tab, footer, diff provider) mounts at once, so the
// request is shared per base: one fetch, and a component mounting after it
// landed reads the answer on its first render instead of flashing a null beat.
// A failure resolves null and is not kept, so the next caller asks again.

const inFlight = new Map<string, Promise<PreviewMeta | null>>();
const settled = new Map<string, PreviewMeta>();

export function loadPreviewMeta(base: string): Promise<PreviewMeta | null> {
  let p = inFlight.get(base);
  if (!p) {
    p = fetch(`${base}meta.json`)
      .then((r) => (r.ok ? (r.json() as Promise<PreviewMeta>) : null))
      .catch(() => null)
      .then((meta) => {
        if (meta) settled.set(base, meta);
        else inFlight.delete(base);
        return meta;
      });
    inFlight.set(base, p);
  }
  return p;
}

/** The meta for `base`: undefined while it loads, null if it could not be read.
 *  A null `base` asks for nothing and answers null. Never suspends — the
 *  banner renders before meta.json lands, from the preview id alone. */
export function usePreviewMeta(base: string | null): PreviewMeta | null | undefined {
  const [answer, setAnswer] = useState<{ base: string; meta: PreviewMeta | null } | null>(null);
  useEffect(() => {
    if (base === null) return;
    let live = true;
    void loadPreviewMeta(base).then((meta) => live && setAnswer({ base, meta }));
    return () => {
      live = false;
    };
  }, [base]);
  if (base === null) return null;
  return answer?.base === base ? answer.meta : settled.get(base);
}

/** Tests only: forget every base, so one test's meta never answers the next. */
export function resetPreviewMetaCache(): void {
  inFlight.clear();
  settled.clear();
}
