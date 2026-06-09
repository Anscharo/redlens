// Thin fetch wrappers that turn a non-2xx response into a thrown error carrying
// a stable artifact name for diagnostics. Artifacts are served same-origin by
// the Bun backend (or GitHub Pages), so no content-integrity check is done here.
export async function fetchJson<T = unknown>(url: string, name: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchText(url: string, name: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.text();
}
