// Which measure decides "this uuid now holds a DIFFERENT document" for a SHORT
// atlas body? Offline bakeoff behind REPLACE_MAX_WORD_OVERLAP in
// src/server/preview/identity.ts. Not on the `pnpm build` chain — it needs the
// network (live docs.json + a preview's diff/patches).
//
//   bun scripts/aux/identity-overlap-bakeoff.ts [--preview-sha <sha>] [--tern]
//
// Why it exists: lineOverlap is line-granular, and 83% of the live atlas is a
// one-line document, so for most of the corpus it can only answer 1.0 or 0.0 —
// it flagged next-gen-atlas#346's `ALMProxy` → `ALM Proxy` spelling pass as an
// identity swap. This scores the candidate replacements over two populations
// built from the live atlas:
//   NEGATIVE (must NOT flag) — real edits from a preview, plus live one-liners
//     with a fraction of their words substituted;
//   POSITIVE (MUST flag) — two unrelated one-liners, and the hard case, two
//     SIBLING one-liners that share their template boilerplate.
// `--tern` adds the on-device ternlight embedding as a third arm (measured and
// rejected 2026-09-29 — see the constant's comment; kept behind the flag so the
// rejection can be re-checked rather than re-argued).

import { lineOverlap, orderedWordContainment } from "../../src/server/preview/identity.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
// atlas#346 — the preview that surfaced the defect. Any preview sha works.
const PREVIEW_SHA = opt("--preview-sha", "e60a8a36d80571c3f7fe4de1180307b5345dcf5c");
const ORIGIN = opt("--origin", "https://atlas.redline.support");
const USE_TERN = flag("--tern");

const tern = USE_TERN ? (require("@ternlight/base") as typeof import("@ternlight/base")) : null;
const vecs = new Map<string, Float32Array>();
function cos(a: string, b: string): number {
  if (!tern) return 0;
  const v = (t: string) => { let x = vecs.get(t); if (!x) vecs.set(t, (x = tern.embed(t))); return x; };
  return tern.cosineSim(v(a), v(b));
}

type Row = { line: number; word: number; tern: number };
const score = (a: string, b: string): Row => ({ line: lineOverlap(a, b), word: orderedWordContainment(a, b), tern: cos(a, b) });

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${ORIGIN}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}

/** Reconstruct (before, after) from a rendered DiffLine[] patch. */
function sides(dl: any[]): [string, string] {
  const a: string[] = [], b: string[] = [];
  for (const l of dl) {
    if (l[0] === "…") continue;
    if (l[0] === "=") { a.push(l[1]); b.push(l[1]); }
    else if (l[0] === "-") a.push(l[1]);
    else if (l[0] === "+") b.push(l[1]);
    else if (l[0] === "~") {
      let x = "", y = "";
      for (const [op, t] of l[1]) { if (op !== "+") x += t; if (op !== "-") y += t; }
      a.push(x); b.push(y);
    }
  }
  return [a.join("\n"), b.join("\n")];
}

// Deterministic PRNG so a re-run reproduces the published numbers.
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

const q = (xs: number[], p: number) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
function stats(name: string, rows: Row[]) {
  console.log(`\n${name}  (n=${rows.length})`);
  for (const k of ["line", "word", ...(USE_TERN ? ["tern" as const] : [])] as (keyof Row)[]) {
    const xs = rows.map((r) => r[k]);
    console.log(`  ${String(k).padEnd(5)} p05=${q(xs, 0.05).toFixed(3)}  p50=${q(xs, 0.5).toFixed(3)}  p95=${q(xs, 0.95).toFixed(3)}`);
  }
}

const main = async () => {
  const docs = (await getJson<{ nodes: Record<string, any> }>("/docs.json")).nodes;
  const diff = await getJson<{ changed: string[]; identitySwap: Record<string, unknown> }>(`/api/preview/${PREVIEW_SHA}/diff.json`);
  const patches = await getJson<Record<string, any[]>>(`/api/preview/${PREVIEW_SHA}/patches.json`);

  // The class at risk: a single-line body long enough to carry signal. Capped
  // at 120 words so the population is ordinary prose, not an inlined table.
  const oneLiners = Object.values(docs).filter((n: any) => {
    const ls = String(n.content ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean);
    const w = String(n.content ?? "").trim().split(/\s+/).length;
    return ls.length === 1 && w >= 12 && w <= 120;
  }) as any[];

  const FILLER = ["updated", "revised", "current", "applicable", "designated", "relevant", "must", "is", "shall", "may"];
  const substitute = (t: string, rate: number) => t.split(" ").map((w) => (rnd() < rate ? pick(FILLER) : w)).join(" ");

  const realEdits = diff.changed.filter((id) => patches[id]).map((id) => score(...sides(patches[id])));
  const synthetic: [string, Row[]][] = [0.05, 0.1, 0.2, 0.3].map((rate) => [
    `substitution ${Math.round(rate * 100)}% of words`,
    Array.from({ length: 400 }, () => { const n = pick(oneLiners); return score(n.content, substitute(n.content, rate)); }),
  ]);

  const unrelated = Array.from({ length: 800 }, () => { const a = pick(oneLiners), b = pick(oneLiners); return a.id === b.id ? null : score(a.content, b.content); }).filter(Boolean) as Row[];
  const byParent = new Map<string, any[]>();
  for (const n of oneLiners) if (n.parentId) { const g = byParent.get(n.parentId); g ? g.push(n) : byParent.set(n.parentId, [n]); }
  const sibGroups = [...byParent.values()].filter((g) => g.length >= 2);
  const siblings = Array.from({ length: 800 }, () => { const g = pick(sibGroups); const a = pick(g), b = pick(g); return a.id === b.id ? null : score(a.content, b.content); }).filter(Boolean) as Row[];

  stats(`NEGATIVE  real edits in preview ${PREVIEW_SHA.slice(0, 8)} (must NOT flag)`, realEdits);
  for (const [n, rows] of synthetic) stats(`NEGATIVE  ${n} (must NOT flag)`, rows);
  stats("POSITIVE  unrelated one-liners (MUST flag)", unrelated);
  stats("POSITIVE  sibling one-liners, shared boilerplate (MUST flag)", siblings);

  const neg = [...realEdits, ...synthetic.flatMap(([, r]) => r)];
  const pos = [...unrelated, ...siblings];
  const pct = (rows: Row[], f: (r: Row) => boolean) => ((100 * rows.filter(f).length) / rows.length).toFixed(1);
  console.log("\nA swap is flagged when the measure is <= t:");
  for (const k of ["line", "word", ...(USE_TERN ? ["tern" as const] : [])] as (keyof Row)[]) {
    console.log(`  ${String(k)}`);
    for (const t of [0, 0.15, 0.4, 0.45, 0.5, 0.53, 0.6, 0.67]) {
      console.log(`    t=${t.toFixed(2)}  ordinary-edit-flagged=${pct(neg, (r) => r[k] <= t)}%  real-swap-missed=${pct(pos, (r) => r[k] > t)}%`);
    }
  }
  if (USE_TERN) {
    console.log("\nternlight as a SECOND gate (flag only when BOTH are low):");
    for (const tw of [0.5, 0.55]) for (const tt of [0.6, 0.7, 0.8]) {
      console.log(`  word<=${tw} & tern<=${tt}  ordinary-edit-flagged=${pct(neg, (r) => r.word <= tw && r.tern <= tt)}%  real-swap-missed=${pct(pos, (r) => !(r.word <= tw && r.tern <= tt))}%`);
    }
  }
  const stillFlagged = Object.keys(diff.identitySwap).filter((id) => patches[id]).map((id) => [id, score(...sides(patches[id]))] as const);
  if (stillFlagged.length) {
    console.log(`\nDocs this preview badged "identity changed":`);
    for (const [id, r] of stillFlagged) console.log(`  ${id}  line=${r.line.toFixed(3)}  word=${r.word.toFixed(3)}${USE_TERN ? `  tern=${r.tern.toFixed(3)}` : ""}`);
  }
};

await main();
