// Thin fetch wrappers that turn a non-2xx response into a thrown error carrying
// a stable artifact name for diagnostics. Artifacts are served same-origin by
// the Bun backend (or GitHub Pages), so no content-integrity check is done here.

// A 404 on a sha-keyed live-atlas URL (/api/atlas/<sha>/…) means our pinned sha
// was pruned (the atlas moved on). Callers force-forward: reload to pick up the
// new sha from fresh HTML (see lib/atlasBase.ts handledStale). Distinct error so
// that path is unambiguous and never confused with a real missing artifact.
export class StaleAtlasError extends Error {
  url: string;
  constructor(url: string) {
    super(`StaleAtlasError: ${url}`);
    this.name = "StaleAtlasError";
    this.url = url;
  }
}

function fail(res: Response, url: string, name: string): never {
  if (res.status === 404 && url.includes("/api/atlas/")) throw new StaleAtlasError(url);
  throw new Error(`${name}: ${res.status}`);
}

export async function fetchJson<T = unknown>(url: string, name: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) fail(res, url, name);
  return res.json() as Promise<T>;
}

export async function fetchText(url: string, name: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) fail(res, url, name);
  return res.text();
}
