// Shared loader for the identity-gate measurement scripts: the live atlas and
// the real, human-labelled edits in atlas_history, as whole (before, after)
// bodies. Read-only and network-bound, so it is off the `pnpm build` chain.
//
// Responses are cached under .cache/identity-bakeoff so a rerun measures the
// same corpus; pass `--refresh` to a caller to refetch.

import fs from "node:fs";
import path from "node:path";
import { makeAtlasGitSource } from "../lib/atlas-git-source.mjs";
import { cleanContent } from "../lib/atlas-parser.mjs";
import { embedBatch } from "../../src/server/retrieval/embed.ts";
import { resolve } from "../../src/server/preview/embeddings-store.ts";
import { lines, sameTitle, words, type SwapNode } from "../../src/server/preview/identity.ts";
import { fetchRemoteNodes } from "./fetchNodes.ts";

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

export const lineCount = (t: string | undefined) => lines(t).length;
export const wordCount = (t: string | undefined) => words(t).length;

export async function loadCorpus(origin: string, refresh = false): Promise<{ docs: Record<string, LiveDoc>; edits: Edit[]; elided: number }> {
  const file = `${CACHE_DIR}/corpus.json`;
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));

  const nodes = await fetchRemoteNodes(origin);
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

/** Qwen3 vectors for `texts`, keyed by the text. Cached on disk one vector per
 *  line, so a rerun costs nothing. With `embed` false it reads the cache only
 *  and makes no network call; texts without a vector are then absent from the
 *  map. The batching and the provider client are the preview build's own
 *  (embeddings-store.ts `resolve`), so a script measures the vectors
 *  production would hold. */
export async function qwenVectors(texts: string[], embed: boolean): Promise<Map<string, Float32Array>> {
  const byHash = new Map<string, Float32Array>();
  if (fs.existsSync(QWEN_CACHE)) {
    for (const l of fs.readFileSync(QWEN_CACHE, "utf8").split("\n")) {
      if (!l) continue;
      try {
        const [t, v] = JSON.parse(l) as [string, number[]];
        byHash.set(t, Float32Array.from(v));
      } catch {
        // a run killed mid-write leaves one partial line; that text is re-embedded
      }
    }
  }
  const todo = [...new Set(texts)].filter((t) => !byHash.has(t));
  console.log(`qwen: ${byHash.size} cached, ${todo.length} ${embed ? "to embed" : "missing"}`);
  if (!embed || !todo.length) return byHash;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const deps = {
    enabled: true,
    liveHashes: async () => new Map<string, string>(),
    knownVectors: async () => new Map<string, number[]>(),
    // The script's own cache is the file above, written as each batch arrives.
    saveVectors: async () => {},
    evictVectors: async () => {},
    embedBatch: async (batch: string[], signal?: AbortSignal) => {
      const out = await embedBatch(batch, signal);
      fs.appendFileSync(QWEN_CACHE, batch.map((t, j) => JSON.stringify([t, out[j].map((x) => +x.toFixed(5))])).join("\n") + "\n");
      return out;
    },
  };
  await resolve(new Map(todo.map((t) => [t, t])), { byHash, deps }, new AbortController().signal);
  return byHash;
}

/** Cosine of two unit vectors. NaN when either is missing. */
export function dot(a: Float32Array | undefined, b: Float32Array | undefined): number {
  if (!a || !b) return NaN;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

// ---- shared by the scripts that score pairs ---------------------------------

/** The chance that a random member of `pos` scores HIGHER than one of `neg`. */
export function auc(pos: number[], neg: number[]): number {
  if (!pos.length || !neg.length) return NaN;
  const all = [...pos.map((v) => [v, 1] as const), ...neg.map((v) => [v, 0] as const)].sort((a, b) => a[0] - b[0]);
  let rankSum = 0, i = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    for (let k = i; k < j; k++) if (all[k][1]) rankSum += (i + j + 1) / 2;
    i = j;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

export const share = (n: number, d: number) => (d ? `${n} of ${d} (${((100 * n) / d).toFixed(1)}%)` : "n/a");

/** The document-number parent. NOT `parentId`: heading depth is capped at 6,
 *  so for most documents `parentId` names a more distant ancestor. */
export const parentOf = (n: { doc_no: string }) => n.doc_no.slice(0, Math.max(0, n.doc_no.lastIndexOf(".")));

/** Could `c` stand in `o`'s slot as a swap the body test would see? The gate's
 *  own title test, so a script and the gate agree on what a retitle is. */
export const swappable = (o: SwapNode, c: SwapNode) => o.id !== c.id && !sameTitle(o.title, c.title) && o.content !== c.content;

export interface HistoryNode extends SwapNode { title: string; type: string; content: string }

const atlasRepo = path.resolve(import.meta.dir, "../../vendor/next-gen-atlas");
export const atlasGit = () => makeAtlasGitSource(atlasRepo);

/** A git snapshot as cleaned nodes, keyed by UUID. */
export function snapshotNodes(snapshot: Map<string, any>): Map<string, HistoryNode> {
  return new Map([...snapshot].map(([id, e]) => [id, { id, doc_no: e.doc_no, title: e.title, type: e.type, content: cleanContent((e.content ?? "").split("\n")) }]));
}

/** Walk the atlas history and call `visit` for every commit in which at least
 *  one document kept its UUID and changed its title — the gate's true input.
 *  `ids` are those documents. Returns the latest snapshot. */
export function walkRetitles(
  visit: (c: { hash: string; date: string }, before: Map<string, HistoryNode>, after: Map<string, HistoryNode>, ids: string[]) => void,
): Map<string, HistoryNode> {
  const { atlasCommits, loadSnapshot } = atlasGit();
  let prev: Map<string, HistoryNode> | null = null;
  for (const c of atlasCommits("origin/main")) {
    const cur = snapshotNodes(loadSnapshot(c.hash) as Map<string, any>);
    if (prev) {
      const ids = [...cur.keys()].filter((id) => prev!.has(id) && !sameTitle(prev!.get(id)!.title, cur.get(id)!.title));
      if (ids.length) visit(c, prev, cur, ids);
    }
    prev = cur;
  }
  return prev!;
}
