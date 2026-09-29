// The identity warnings, judged by meaning. The preview build does not wait
// for them: diff.json carries a fast verdict by lines and words, and the server
// writes identity.json (identity.<key>.json for a chosen base) once the
// document vectors are made. This loads that file after the page is up.
//
//   200  the verdict — it REPLACES diff.json's identitySwap and formerUuid
//   202  not written yet — wait and ask again
//   else none is coming (no vectors for this preview) — keep diff.json's

import type { FormerUuid, IdentitySwap } from "./previewDiff";

export interface IdentityVerdict {
  identitySwap: Record<string, IdentitySwap>;
  formerUuid: Record<string, FormerUuid>;
}

// About two minutes in all. The server's own budget is 60 seconds for the
// vectors and 20 for each diff base.
export const IDENTITY_WAITS_MS = [2000, 3000, 5000, 5000, 10_000, 10_000, 15_000, 15_000, 30_000, 30_000];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });
}

/** Resolves to the verdict, or to null when none is coming, the wait ran out,
 *  or `signal` aborted. Never rejects. `key` is the base the DIFF was loaded
 *  for — null for the `auto` pair — so the two files describe one comparison. */
export async function loadIdentityVerdict(
  base: string,
  key: string | null,
  opts: { signal?: AbortSignal; fetch?: typeof fetch; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<IdentityVerdict | null> {
  const get = opts.fetch ?? fetch;
  const wait = opts.wait ?? sleep;
  const url = key ? `${base}identity.${key}.json` : `${base}identity.json`;
  try {
    for (let attempt = 0; ; attempt++) {
      const r = await get(url, { signal: opts.signal });
      if (r.status === 200) {
        const v = (await r.json()) as Partial<IdentityVerdict>;
        return { identitySwap: v.identitySwap ?? {}, formerUuid: v.formerUuid ?? {} };
      }
      if (r.status !== 202 || attempt >= IDENTITY_WAITS_MS.length) return null;
      await wait(IDENTITY_WAITS_MS[attempt], opts.signal);
    }
  } catch {
    return null;
  }
}
