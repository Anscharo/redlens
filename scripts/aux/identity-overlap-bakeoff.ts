// Which measure decides "this uuid now holds a DIFFERENT document" for a SHORT
// atlas body? Offline bakeoff behind REPLACE_MAX_WORD_OVERLAP in
// src/server/preview/identity.ts. Not on the `pnpm build` chain — it needs the
// network (live docs.json + a preview's diff/patches).
//
//   bun scripts/aux/identity-overlap-bakeoff.ts [--preview-sha <sha>] [--tern] [--qwen]
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
// `--tern` adds the on-device ternlight embedding as a third arm, `--qwen` the
// hosted Qwen3 one the atlas search uses (needs OPENROUTER_API_KEY; responses
// are disk-cached under .cache/identity-bakeoff). Both were measured and
// rejected 2026-09-29 — see the constant's comment; kept behind flags so the
// rejection can be re-checked rather than re-argued.
//
// Each embedding is scored two ways, because they are different proposals:
//   - as a MEASURE, replacing the word containment outright;
//   - as a VETO, one-sided — the word measure decides to flag, and a high
//     embedding similarity overrides it. A veto can only ever remove flags, so
//     it is judged on what it rescues (ordinary edits wrongly flagged) against
//     what it costs (real swaps it talks us out of).

import { lineOverlap, orderedWordContainment } from "../../src/server/preview/identity.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? d) : d; };
// atlas#346 — the preview that surfaced the defect. Any preview sha works.
const PREVIEW_SHA = opt("--preview-sha", "e60a8a36d80571c3f7fe4de1180307b5345dcf5c");
const ORIGIN = opt("--origin", "https://atlas.redline.support");
const USE_TERN = flag("--tern");

const USE_QWEN = flag("--qwen");
const ARMS = ["line", "word", "idf", ...(USE_TERN ? (["tern"] as const) : []), ...(USE_QWEN ? (["qwen"] as const) : [])] as const;

// IDF arm. Same lexical axis as `word` and the same DP — but each matched token
// contributes its inverse document frequency instead of 1. The unweighted LCS
// is dominated by stopwords, while the token that actually decides the hard
// sibling case is the entity name ("Keel" vs "Obex"), which is rare and
// therefore nearly weightless. Document frequency comes from the live corpus;
// in production it would come from the base snapshot the build already parsed.
const df = new Map<string, number>();
let docCount = 0;
const idfToks = (t: string | undefined) => (t ?? "").toLowerCase().match(/[a-z0-9_]+/g) ?? [];
function buildDf(contents: string[]): void {
  docCount = contents.length;
  for (const c of contents) for (const w of new Set(idfToks(c))) df.set(w, (df.get(w) ?? 0) + 1);
}
const idfOf = (w: string) => Math.log(docCount / (1 + (df.get(w) ?? 0)));
function idfContainment(oldT: string | undefined, newT: string | undefined): number {
  const a = idfToks(oldT), b = idfToks(newT);
  if (a.length < RELOCATION_MIN_WORDS_LOCAL) return 1;
  const total = a.reduce((sum, w) => sum + idfOf(w), 0);
  if (total <= 0) return 1;
  if (a.length * b.length > 400_000) return 0; // same cost cap as orderedWordContainment
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? diag + idfOf(a[i - 1]) : Math.max(dp[j], dp[j - 1]);
      diag = up;
    }
  }
  return dp[b.length] / total;
}
const RELOCATION_MIN_WORDS_LOCAL = 4;

const tern = USE_TERN ? (require("@ternlight/base") as typeof import("@ternlight/base")) : null;
const vecs = new Map<string, Float32Array>();
function cos(a: string, b: string): number {
  if (!tern) return 0;
  const v = (t: string) => { let x = vecs.get(t); if (!x) vecs.set(t, (x = tern.embed(t))); return x; };
  return tern.cosineSim(v(a), v(b));
}

// Qwen3 via OpenRouter, through the SAME client the atlas search embeds with, so
// this measures the vectors production would actually have. Every distinct text
// is embedded once and cached on disk — a rerun costs nothing.
const qwenVecs = new Map<string, Float32Array>();
const QWEN_CACHE = ".cache/identity-bakeoff/qwen.json";
async function loadQwen(texts: string[]): Promise<void> {
  if (!USE_QWEN) return;
  const { embedBatch } = await import("../../src/server/retrieval/embed.ts");
  const fs = await import("node:fs");
  const cached: Record<string, number[]> = fs.existsSync(QWEN_CACHE) ? JSON.parse(fs.readFileSync(QWEN_CACHE, "utf8")) : {};
  for (const [t, v] of Object.entries(cached)) qwenVecs.set(t, Float32Array.from(v));
  const todo = [...new Set(texts)].filter((t) => !qwenVecs.has(t));
  console.log(`qwen: ${qwenVecs.size} cached, ${todo.length} to embed`);
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const out = await embedBatch(batch);
    batch.forEach((t, j) => { qwenVecs.set(t, Float32Array.from(out[j])); cached[t] = out[j]; });
    process.stdout.write(`\r  embedded ${Math.min(i + 100, todo.length)}/${todo.length}`);
  }
  if (todo.length) {
    fs.mkdirSync(".cache/identity-bakeoff", { recursive: true });
    fs.writeFileSync(QWEN_CACHE, JSON.stringify(cached));
    console.log("");
  }
}
function qwenCos(a: string, b: string): number {
  const va = qwenVecs.get(a), vb = qwenVecs.get(b);
  if (!va || !vb) return 0;
  let d = 0;
  for (let i = 0; i < va.length; i++) d += va[i] * vb[i]; // both already L2-normalized
  return d;
}

type Row = { line: number; word: number; idf: number; tern: number; qwen: number; a: string; b: string };
const score = (a: string, b: string): Row => ({
  line: lineOverlap(a, b), word: orderedWordContainment(a, b), idf: idfContainment(a, b), tern: cos(a, b), qwen: 0, a, b,
});

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
  for (const k of ARMS) {
    const xs = rows.map((r) => r[k] as number);
    console.log(`  ${String(k).padEnd(5)} p05=${q(xs, 0.05).toFixed(3)}  p50=${q(xs, 0.5).toFixed(3)}  p95=${q(xs, 0.95).toFixed(3)}`);
  }
}

const main = async () => {
  const docs = (await getJson<{ nodes: Record<string, any> }>("/docs.json")).nodes;
  buildDf(Object.values(docs).map((n: any) => String(n.content ?? "")));
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

  const neg = [...realEdits, ...synthetic.flatMap(([, r]) => r)];
  const pos = [...unrelated, ...siblings];
  const badged = Object.keys(diff.identitySwap).filter((id) => patches[id]).map((id) => [id, score(...sides(patches[id]))] as const);

  // Embed every distinct body once, then fill the qwen column.
  const all = [...neg, ...pos, ...badged.map(([, r]) => r)];
  await loadQwen(all.flatMap((r) => [r.a, r.b]));
  if (USE_QWEN) for (const r of all) r.qwen = qwenCos(r.a, r.b);

  stats(`NEGATIVE  real edits in preview ${PREVIEW_SHA.slice(0, 8)} (must NOT flag)`, realEdits);
  for (const [n, rows] of synthetic) stats(`NEGATIVE  ${n} (must NOT flag)`, rows);
  stats("POSITIVE  unrelated one-liners (MUST flag)", unrelated);
  stats("POSITIVE  sibling one-liners, shared boilerplate (MUST flag)", siblings);

  const pct = (rows: Row[], f: (r: Row) => boolean) => ((100 * rows.filter(f).length) / rows.length).toFixed(1);
  console.log("\n=== AS A MEASURE — a swap is flagged when the measure is <= t ===");
  for (const k of ARMS) {
    console.log(`  ${String(k)}`);
    for (const t of [0, 0.15, 0.3, 0.4, 0.45, 0.5, 0.53, 0.6, 0.67, 0.75]) {
      console.log(
        `    t=${t.toFixed(2)}  ordinary-edit-flagged=${pct(neg, (r) => (r[k] as number) <= t)}%` +
        `  real-swap-missed=${pct(pos, (r) => (r[k] as number) > t)}%` +
        `  (hard siblings missed=${pct(siblings, (r) => (r[k] as number) > t)}%)`,
      );
    }
  }

  // The veto framing: the word measure has already decided to flag. Can a high
  // embedding similarity rescue the ordinary edits caught in that net, without
  // talking us out of the real swaps sitting right beside them?
  const WORD_T = 0.5;
  const wrongly = neg.filter((r) => r.word <= WORD_T); // ordinary edits the word measure flags
  const rightly = pos.filter((r) => r.word <= WORD_T); // real swaps it flags
  console.log(`\n=== AS A VETO on top of word<=${WORD_T} ===`);
  console.log(`  the net holds ${wrongly.length} ordinary edits (to rescue) and ${rightly.length} real swaps (to keep)`);
  for (const k of ARMS.filter((a) => a === "tern" || a === "qwen")) {
    const w = wrongly.map((r) => r[k] as number), g = rightly.map((r) => r[k] as number);
    console.log(`  ${String(k)}: ordinary edits in the net p50=${q(w, 0.5).toFixed(3)} | real swaps in the net p50=${q(g, 0.5).toFixed(3)}`);
    for (const v of [0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
      const resc = wrongly.filter((r) => (r[k] as number) > v).length;
      const lost = rightly.filter((r) => (r[k] as number) > v).length;
      console.log(`    veto when ${String(k)}>${v.toFixed(2)}  rescues ${resc}/${wrongly.length} ordinary edits, loses ${lost}/${rightly.length} real swaps  (net flags removed: ${resc + lost})`);
    }
  }

  if (badged.length) {
    console.log(`\nDocs this preview badged "identity changed":`);
    for (const [id, r] of badged) console.log(`  ${id}  ${ARMS.map((k) => `${k}=${(r[k] as number).toFixed(3)}`).join("  ")}`);
  }
};

await main();
