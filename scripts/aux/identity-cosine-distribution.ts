// How far does a real atlas edit move a document's embedding?
//
//   bun scripts/aux/identity-cosine-distribution.ts [--qwen] [--origin <url>] [--refresh]
//
// Reports the distribution of cos(before, after) over the real, human-labelled
// edits in atlas_history, by change_kind, beside two reference populations
// that are NOT edits: a body paired with an unrelated one, and with a sibling
// (same parent). A description of the corpus, not an input to the identity
// gate — see docs/research/identity-swap-detection.md, thread 5, for why an
// embedding cannot decide that gate.
//
// Two embeddings: ternlight (on-device, 384 dims, always on) and, with --qwen,
// the hosted Qwen3 the atlas search uses (needs OPENROUTER_API_KEY; vectors are
// disk-cached under .cache/identity-bakeoff). Ternlight reads only the first
// 128 tokens, so an edit past that point scores exactly 1 on it.

import fs from "node:fs";
import { createHash } from "node:crypto";
import { bodyWhollyReplaced, JUDGEABLE_MIN_WORDS, SHORT_BODY_MAX_LINES } from "../../src/server/preview/identity.ts";
import { loadCorpus, lineCount, wordCount, prng, quantile, qwenVectors, dot, type LiveDoc } from "./identity-corpus.ts";

const args = process.argv.slice(2);
const ORIGIN = args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "https://atlas.redline.support";
const USE_QWEN = args.includes("--qwen");
const OUT = ".cache/identity-bakeoff/cosine.json";

// Ternlight takes ~13ms a body, four minutes over the corpus, so each pair's
// score is cached too.
const TERN_CACHE = ".cache/identity-bakeoff/tern-cosine.json";
const tern = require("@ternlight/base") as typeof import("@ternlight/base");
const ternVecs = new Map<string, Float32Array>();
const ternSeen: Record<string, number> = fs.existsSync(TERN_CACHE) ? JSON.parse(fs.readFileSync(TERN_CACHE, "utf8")) : {};
const ternCos = (a: string, b: string) => {
  const key = createHash("sha1").update(a).update("\0").update(b).digest("hex");
  if (key in ternSeen) return ternSeen[key];
  const v = (t: string) => { let x = ternVecs.get(t); if (!x) ternVecs.set(t, (x = tern.embed(t))); return x; };
  return (ternSeen[key] = tern.cosineSim(v(a), v(b)));
};

let qwenVecs = new Map<string, Float32Array>();
const qwenCos = (a: string, b: string) => dot(qwenVecs.get(a), qwenVecs.get(b));

interface Pair { group: string; size: "short" | "long"; a: string; b: string; tern: number; qwen: number; flagged: boolean }

const main = async () => {
  const { docs, edits } = await loadCorpus(ORIGIN, args.includes("--refresh"));
  const size = (t: string) => (lineCount(t) <= SHORT_BODY_MAX_LINES ? "short" : "long") as Pair["size"];
  const pairs: Pair[] = [];
  const add = (group: string, a: string, b: string) => {
    if (wordCount(a) < JUDGEABLE_MIN_WORDS || !b.trim()) return;
    pairs.push({ group, size: size(a), a, b, tern: 0, qwen: NaN, flagged: bodyWhollyReplaced(a, b) });
  };
  for (const e of edits) add(`edit: ${e.kind}`, e.before, e.after);

  const { pick } = prng(7);
  const live = Object.values(docs).filter((d) => wordCount(d.content) >= JUDGEABLE_MIN_WORDS);
  const byParent = new Map<string, LiveDoc[]>();
  for (const d of live) if (d.parentId) (byParent.get(d.parentId) ?? byParent.set(d.parentId, []).get(d.parentId)!).push(d);
  const families = [...byParent.values()].filter((g) => g.length >= 2);
  for (let i = 0; i < 1500; i++) {
    const a = pick(live), b = pick(live);
    if (a.id !== b.id && a.content !== b.content) add("not an edit: unrelated", a.content!, b.content!);
    const g = pick(families), x = pick(g), y = pick(g);
    if (x.id !== y.id && x.content !== y.content) add("not an edit: sibling", x.content!, y.content!);
  }

  if (USE_QWEN) qwenVecs = await qwenVectors(pairs.flatMap((p) => [p.a, p.b]), true);
  for (const p of pairs) { p.tern = ternCos(p.a, p.b); if (USE_QWEN) p.qwen = qwenCos(p.a, p.b); }
  fs.mkdirSync(".cache/identity-bakeoff", { recursive: true });
  fs.writeFileSync(TERN_CACHE, JSON.stringify(ternSeen));

  const GROUPS = ["edit: lint", "edit: typo", "edit: semantic", "not an edit: sibling", "not an edit: unrelated"];
  const arms = ["tern", ...(USE_QWEN ? ["qwen"] : [])] as ("tern" | "qwen")[];
  const f = (x: number) => x.toFixed(3);
  const summary: Record<string, unknown>[] = [];

  for (const arm of arms) {
    console.log(`\n=== cos(before, after) — ${arm === "tern" ? "ternlight, 384 dims, first 128 tokens" : "Qwen3-embedding-8b, 1,024 dims"} ===`);
    console.log(`  ${"population".padEnd(24)} ${"size".padEnd(6)} ${"n".padStart(5)}    min    p01    p05    p25    p50    p75    p95    mean   1-p50`);
    for (const g of GROUPS) for (const s of ["short", "long", "all"] as const) {
      const xs = pairs.filter((p) => p.group === g && (s === "all" || p.size === s)).map((p) => p[arm]).filter((x) => !Number.isNaN(x));
      if (!xs.length) continue;
      const mean = xs.reduce((t, x) => t + x, 0) / xs.length;
      const q = (p: number) => quantile(xs, p);
      console.log(`  ${g.padEnd(24)} ${s.padEnd(6)} ${String(xs.length).padStart(5)}  ${[Math.min(...xs), q(0.01), q(0.05), q(0.25), q(0.5), q(0.75), q(0.95), mean].map(f).join("  ")}  ${f(1 - q(0.5))}`);
      summary.push({ arm, group: g, size: s, n: xs.length, min: Math.min(...xs), p01: q(0.01), p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), mean });
    }

    // Share of each population per band of similarity.
    const EDGES = [-1, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.999, 1.0001];
    console.log(`\n  share of each population by band (%):`);
    console.log(`  ${"band".padEnd(14)} ${GROUPS.map((g) => g.replace("not an edit: ", "").replace("edit: ", "").padStart(10)).join("")}`);
    for (let i = 0; i < EDGES.length - 1; i++) {
      const lo = EDGES[i], hi = EDGES[i + 1];
      const label = i === 0 ? `< ${hi}` : hi > 1 ? `>= ${lo}` : `${lo} - ${hi}`;
      const cells = GROUPS.map((g) => {
        const xs = pairs.filter((p) => p.group === g).map((p) => p[arm]).filter((x) => !Number.isNaN(x));
        return ((100 * xs.filter((x) => x >= lo && x < hi).length) / xs.length).toFixed(1).padStart(10);
      });
      console.log(`  ${label.padEnd(14)} ${cells.join("")}`);
    }

    // How well does a single cut separate "an edit" from "not an edit"?
    const editX = pairs.filter((p) => p.group.startsWith("edit")).map((p) => p[arm]);
    const sibX = pairs.filter((p) => p.group === "not an edit: sibling").map((p) => p[arm]);
    console.log(`\n  one cut, edits against siblings:`);
    for (const t of [0.5, 0.6, 0.7, 0.8, 0.85, 0.9]) {
      console.log(`    cos<=${t.toFixed(2)}  edits below ${((100 * editX.filter((x) => x <= t).length) / editX.length).toFixed(2)}%   siblings above ${((100 * sibX.filter((x) => x > t).length) / sibX.length).toFixed(2)}%`);
    }

    // Thread 5's veto, on real data: inside what the shipped gate flags, could
    // a high similarity rescue real edits without losing swaps? The real edits
    // it flags are all `semantic` — it flags no cosmetic one — so "rescued"
    // here means a real content edit spared, not a false accusation removed.
    const netEdits = pairs.filter((p) => p.flagged && p.group.startsWith("edit")).map((p) => p[arm]);
    const netSwaps = pairs.filter((p) => p.flagged && !p.group.startsWith("edit")).map((p) => p[arm]);
    console.log(`\n  inside the shipped gate's flags: ${netEdits.length} real edits (${pairs.filter((p) => p.flagged && p.group !== "edit: semantic" && p.group.startsWith("edit")).length} cosmetic), ${netSwaps.length} synthetic swaps`);
    console.log(`    real edits  p05=${f(quantile(netEdits, 0.05))} p50=${f(quantile(netEdits, 0.5))} p95=${f(quantile(netEdits, 0.95))}`);
    console.log(`    swaps       p05=${f(quantile(netSwaps, 0.05))} p50=${f(quantile(netSwaps, 0.5))} p95=${f(quantile(netSwaps, 0.95))}`);
    for (const v of [0.6, 0.7, 0.8, 0.85, 0.9, 0.95]) {
      console.log(`    veto when cos>${v.toFixed(2)}  spares ${netEdits.filter((x) => x > v).length}/${netEdits.length} real edits, loses ${netSwaps.filter((x) => x > v).length}/${netSwaps.length} swaps`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ origin: ORIGIN, summary, pairs: pairs.map(({ group, size, tern, qwen }) => ({ group, size, tern: +tern.toFixed(4), qwen: Number.isNaN(qwen) ? null : +qwen.toFixed(4) })) }));
  console.log(`\nwrote ${OUT} (${pairs.length} pairs)`);
};

await main();
