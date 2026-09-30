// Measure the identity gate's body test against REAL, HUMAN-LABELLED edits.
//
//   bun scripts/aux/identity-real-corpus.ts [--origin https://atlas.redline.support]
//
// Every false-flag number in docs/research/identity-swap-detection.md rests on
// SYNTHETIC negatives — live one-liners with random words substituted. This
// replaces them with the real thing: atlas_history's `change_kind` labels,
// backfilled by migration 006, mark 2,641 edits as `lint` (whitespace/punctuation
// only) or `typo` (<=4 alphanumeric chars, no run over 2). Those are exactly the
// class that must never be badged "identity changed", and they come with their
// own diffs, so the before/after is real rather than generated.
//
// Scope, stated because it bounds the claim:
//   * Only entries whose stored diff is COMPLETE are usable. build-history
//     trims to changed lines +/- context with "…" between hunks and caps at 20
//     lines, so a multi-line doc's diff cannot be reconstructed into a full
//     body. A ONE-LINE doc's diff is a single "~" op and is exact — and
//     one-liners are 83% of the atlas and the whole population this gate gets
//     wrong, so the restriction costs little and is stated rather than hidden.
//   * atlas_history stores no title, so this measures the BODY test only, not
//     the whole of detectIdentitySwaps. That is the right target: the gate only
//     reaches the body test once a title has changed, so this answers "when a
//     real cosmetic edit also touches the title, does the body measure wave it
//     through?" — which is precisely what atlas#346 was.

import { bodyWhollyReplaced, lineOverlap, orderedWordContainment, REPLACE_MAX_OVERLAP, REPLACE_MAX_WORD_OVERLAP, SHORT_BODY_MAX_LINES, JUDGEABLE_MIN_WORDS } from "../../src/server/preview/identity.ts";

const args = process.argv.slice(2);
const ORIGIN = args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "https://atlas.redline.support";

// ---- IDF arm (thread 1), identical to the bakeoff's -------------------------
const df = new Map<string, number>();
let docCount = 0;
const toks = (t: string | undefined) => (t ?? "").toLowerCase().match(/[a-z0-9_]+/g) ?? [];
const idfOf = (w: string) => Math.log(docCount / (1 + (df.get(w) ?? 0)));
function idfContainment(oldT: string | undefined, newT: string | undefined): number {
  const a = toks(oldT), b = toks(newT);
  if (a.length < 4) return 1;
  const total = a.reduce((s, w) => s + idfOf(w), 0);
  if (total <= 0) return 1;
  if (a.length * b.length > 400_000) return 0;
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

/** Reconstruct (before, after) from a stored DiffLine[]. Returns null when the
 *  diff is elided — "…" means context was dropped and neither side is whole. */
function sides(dl: any[]): [string, string] | null {
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

const main = async () => {
  const docsRes = await fetch(`${ORIGIN}/docs.json`);
  const nodes = (await docsRes.json()).nodes as Record<string, any>;
  const ids = Object.keys(nodes);
  docCount = ids.length;
  for (const n of Object.values(nodes)) for (const w of new Set(toks(String(n.content ?? "")))) df.set(w, (df.get(w) ?? 0) + 1);
  console.log(`live atlas: ${ids.length} docs`);

  // Pull every document's history; the labels we want are sparse but the
  // endpoint is batched, so this is ~6 requests.
  const entries: { id: string; kind: string; diff: any[] }[] = [];
  for (let i = 0; i < ids.length; i += 2000) {
    const res = await fetch(`${ORIGIN}/api/history/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ids.slice(i, i + 2000) }),
    });
    if (!res.ok) throw new Error(`history/batch ${res.status}`);
    const byDoc = (await res.json()) as Record<string, any[]>;
    for (const [id, rows] of Object.entries(byDoc)) {
      for (const r of rows) {
        if (r.changeType !== "modified" && r.change_type !== "modified") continue;
        const kind = r.changeKind ?? r.change_kind;
        if (kind !== "lint" && kind !== "typo" && kind !== "semantic") continue;
        if (r.diff) entries.push({ id, kind, diff: r.diff });
      }
    }
    process.stdout.write(`\r  fetched ${Math.min(i + 2000, ids.length)}/${ids.length} docs' history`);
  }
  console.log("");

  const byKind = (k: string) => entries.filter((e) => e.kind === k);
  console.log(`labelled modified entries with a diff: lint=${byKind("lint").length} typo=${byKind("typo").length} semantic=${byKind("semantic").length}`);

  // Keep only entries whose diff reconstructs a WHOLE body, and which carry
  // enough text for the gate to judge at all (it declines below this).
  // `shipped` is bodyWhollyReplaced itself — the function that actually gates
  // the badge. The word/idf comparison below is over SHORT bodies only, the
  // population thread 1 asked about; since 2026-09-29 the gate asks the word
  // measure of every body, and identity-long-body.ts measures the long ones.
  type Row = { kind: string; id: string; lines: number; shipped: boolean; line: number; word: number; idf: number };
  const rows: Row[] = [];
  let elided = 0, tooShort = 0;
  for (const e of entries) {
    const s2 = sides(e.diff);
    if (!s2) { elided++; continue; }
    const [before, after] = s2;
    if ((before.toLowerCase().match(/[a-z0-9]+/g) ?? []).length < JUDGEABLE_MIN_WORDS) { tooShort++; continue; }
    rows.push({
      kind: e.kind, id: e.id,
      lines: before.split("\n").map((l) => l.trim()).filter(Boolean).length,
      shipped: bodyWhollyReplaced(before, after),
      line: lineOverlap(before, after),
      word: orderedWordContainment(before, after),
      idf: idfContainment(before, after),
    });
  }
  console.log(`usable: ${rows.length}  (dropped ${elided} elided diffs, ${tooShort} too short to judge)`);

  const cosmetic = rows.filter((r) => r.kind !== "semantic");
  const semantic = rows.filter((r) => r.kind === "semantic");
  const short = (xs: Row[]) => xs.filter((r) => r.lines <= SHORT_BODY_MAX_LINES);
  const long = (xs: Row[]) => xs.filter((r) => r.lines > SHORT_BODY_MAX_LINES);
  console.log(`  cosmetic (lint+typo, must NEVER be badged): ${cosmetic.length}  (${short(cosmetic).length} short / ${long(cosmetic).length} long)`);
  console.log(`  semantic (a real content edit; mostly must not be badged either): ${semantic.length}  (${short(semantic).length} short / ${long(semantic).length} long)`);

  const pct = (xs: Row[], f: (r: Row) => boolean) => (xs.length ? ((100 * xs.filter(f).length) / xs.length).toFixed(2) : "n/a");
  const n = (xs: Row[], f: (r: Row) => boolean) => `${xs.filter(f).length}/${xs.length}`;

  console.log(`\n=== WHAT SHIPS — bodyWhollyReplaced on a genuine edit ===`);
  console.log(`(the gate reaches this test only once a title changed, as in atlas#346)\n`);
  for (const [label, pop] of [["cosmetic", cosmetic], ["semantic", semantic]] as const) {
    console.log(`  ${label.padEnd(9)} all=${pct(pop, (r) => r.shipped).padStart(6)}% (${n(pop, (r) => r.shipped)})` +
      `   short=${pct(short(pop), (r) => r.shipped).padStart(6)}% (${n(short(pop), (r) => r.shipped)})` +
      `   long=${pct(long(pop), (r) => r.shipped).padStart(6)}% (${n(long(pop), (r) => r.shipped)})`);
  }
  console.log(`\n  for comparison, the PRE-FIX gate (lineOverlap on every body):`);
  for (const [label, pop] of [["cosmetic", cosmetic], ["semantic", semantic]] as const) {
    console.log(`  ${label.padEnd(9)} all=${pct(pop, (r) => r.line <= REPLACE_MAX_OVERLAP).padStart(6)}% (${n(pop, (r) => r.line <= REPLACE_MAX_OVERLAP)})`);
  }

  console.log(`\n=== THREAD 1: word vs idf, over SHORT bodies (3 lines or fewer) ===`);
  console.log(`  measure  threshold   cosmetic flagged        semantic flagged`);
  for (const t of [0.4, 0.45, 0.5, 0.53, 0.6]) {
    const mark = t === REPLACE_MAX_WORD_OVERLAP ? "  <- shipped" : "";
    console.log(`  word     ${t.toFixed(2)}        ${pct(short(cosmetic), (r) => r.word <= t).padStart(6)}% (${n(short(cosmetic), (r) => r.word <= t).padEnd(9)})   ${pct(short(semantic), (r) => r.word <= t).padStart(6)}% (${n(short(semantic), (r) => r.word <= t)})${mark}`);
  }
  for (const t of [0.3, 0.4, 0.45, 0.5, 0.6]) {
    console.log(`  idf      ${t.toFixed(2)}        ${pct(short(cosmetic), (r) => r.idf <= t).padStart(6)}% (${n(short(cosmetic), (r) => r.idf <= t).padEnd(9)})   ${pct(short(semantic), (r) => r.idf <= t).padStart(6)}% (${n(short(semantic), (r) => r.idf <= t)})`);
  }

  const bad = cosmetic.filter((r) => r.shipped);
  if (bad.length) {
    console.log(`\ncosmetic edits the SHIPPED gate still flags (${bad.length}):`);
    for (const r of bad.slice(0, 15)) {
      console.log(`  ${r.id}  ${r.kind}  lines=${r.lines} line=${r.line.toFixed(3)} word=${r.word.toFixed(3)}  "${String(nodes[r.id]?.title ?? "").slice(0, 55)}"`);
    }
  }
};

await main();
