// Shared loader for the identity-gate measurement scripts: the live atlas and
// the real, human-labelled edits in atlas_history, as whole (before, after)
// bodies. Read-only and network-bound, so it is off the `pnpm build` chain.
//
// Responses are cached under .cache/identity-bakeoff so a rerun measures the
// same corpus; pass `--refresh` to a caller to refetch.

import fs from "node:fs";

export type Kind = "lint" | "typo" | "semantic";
export interface Edit { id: string; kind: Kind; before: string; after: string }
export interface LiveDoc { id: string; title?: string; content?: string; parentId?: string | null }

const CACHE_DIR = ".cache/identity-bakeoff";

/** Reconstruct (before, after) from a stored DiffLine[]. Returns null when the
 *  diff is elided — "…" means context was dropped and neither side is whole. */
export function sides(dl: any[]): [string, string] | null {
  if (!Array.isArray(dl) || dl.length === 0) return null;
  const a: string[] = [], b: string[] = [];
  for (const l of dl) {
    if (l[0] === "…") return null;
    if (l[0] === "=") { a.push(l[1]); b.push(l[1]); }
    else if (l[0] === "-") a.push(l[1]);
    else if (l[0] === "+") b.push(l[1]);
    else if (l[0] === "~") {
      let x = "", y = "";
      for (const [op, t] of l[1] ?? []) { if (op !== "+") x += t; if (op !== "-") y += t; }
      a.push(x); b.push(y);
    }
  }
  return [a.join("\n"), b.join("\n")];
}

export const lineCount = (t: string | undefined) => (t ?? "").split("\n").map((l) => l.trim()).filter(Boolean).length;
export const wordCount = (t: string | undefined) => ((t ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []).length;

export async function loadCorpus(origin: string, refresh = false): Promise<{ docs: Record<string, LiveDoc>; edits: Edit[]; elided: number }> {
  const file = `${CACHE_DIR}/corpus.json`;
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));

  const docsRes = await fetch(`${origin}/docs.json`);
  if (!docsRes.ok) throw new Error(`docs.json ${docsRes.status}`);
  const nodes = (await docsRes.json()).nodes as Record<string, any>;
  const docs: Record<string, LiveDoc> = {};
  for (const [id, n] of Object.entries(nodes)) docs[id] = { id, title: n.title, content: n.content, parentId: n.parentId };

  const ids = Object.keys(nodes);
  const edits: Edit[] = [];
  let elided = 0;
  for (let i = 0; i < ids.length; i += 2000) {
    const res = await fetch(`${origin}/api/history/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ids.slice(i, i + 2000) }),
    });
    if (!res.ok) throw new Error(`history/batch ${res.status}`);
    const byDoc = (await res.json()) as Record<string, any[]>;
    for (const [id, rows] of Object.entries(byDoc)) {
      for (const r of rows) {
        if ((r.changeType ?? r.change_type) !== "modified") continue;
        const kind = r.changeKind ?? r.change_kind;
        if (kind !== "lint" && kind !== "typo" && kind !== "semantic") continue;
        if (!r.diff) continue;
        const s = sides(r.diff);
        if (!s) { elided++; continue; }
        edits.push({ id, kind, before: s[0], after: s[1] });
      }
    }
  }
  const out = { docs, edits, elided };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

// Deterministic PRNG so a rerun reproduces the published numbers.
export function prng(seed = 7) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  return { rnd, pick };
}

export function quantile(xs: number[], p: number): number {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(p * (s.length - 1))];
}

const QWEN_CACHE = `${CACHE_DIR}/qwen-cosine.json`;

/** Qwen3 vectors for `texts`, through the SAME client the atlas search embeds
 *  with. Cached on disk one vector per line, so a rerun costs nothing. With
 *  `embed` false it reads the cache only and makes no network call; texts
 *  without a vector are then simply absent from the map. */
export async function qwenVectors(texts: string[], embed: boolean): Promise<Map<string, Float32Array>> {
  const vecs = new Map<string, Float32Array>();
  if (fs.existsSync(QWEN_CACHE)) {
    for (const l of fs.readFileSync(QWEN_CACHE, "utf8").split("\n")) {
      if (!l) continue;
      try {
        const [t, v] = JSON.parse(l) as [string, number[]];
        vecs.set(t, Float32Array.from(v));
      } catch {
        // a run killed mid-write leaves one partial line; that text is re-embedded
      }
    }
  }
  const todo = [...new Set(texts)].filter((t) => !vecs.has(t));
  console.log(`qwen: ${vecs.size} cached, ${todo.length} ${embed ? "to embed" : "missing"}`);
  if (!embed || !todo.length) return vecs;
  const { embedBatch } = await import("../../src/server/retrieval/embed.ts");
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const batches: string[][] = [];
  for (let i = 0; i < todo.length; i += 64) batches.push(todo.slice(i, i + 64));
  let done = 0;
  const worker = async () => {
    for (let batch = batches.shift(); batch; batch = batches.shift()) {
      const out = await embedBatch(batch);
      batch.forEach((t, j) => vecs.set(t, Float32Array.from(out[j])));
      fs.appendFileSync(QWEN_CACHE, batch.map((t, j) => JSON.stringify([t, out[j].map((x) => +x.toFixed(5))])).join("\n") + "\n");
      process.stdout.write(`\r  embedded ${(done += batch.length)}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log("");
  return vecs;
}

/** Cosine of two unit vectors. NaN when either is missing. */
export function dot(a: Float32Array | undefined, b: Float32Array | undefined): number {
  if (!a || !b) return NaN;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}
