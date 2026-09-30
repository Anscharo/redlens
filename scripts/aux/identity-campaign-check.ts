// Does the bulk-rename rule (renameCampaigns in src/server/preview/identity.ts)
// ever fire on documents that were NOT renamed together? Offline, no builds.
//
//   bun scripts/aux/identity-campaign-check.ts [--prs 2000] [--size 50]
//
// The rule spares a changed document when >= CAMPAIGN_MIN_DOCS of them share
// one title substitution. Its failure mode is a FALSE SUPPRESSION: several
// documents genuinely repurposed in one PR, whose title changes happen to
// collide on a key, silently losing their badge. This measures how collidable
// real atlas titles actually are, by simulating PR-sized batches of independent
// swaps drawn from the live corpus — a swap being one document's title
// replaced by an unrelated document's.
//
// It also checks the rule still fires on what it is FOR: a terminology pass
// across a family of template documents.

import { renameCampaigns, titleSubstitution, CAMPAIGN_MIN_DOCS, type SwapNode } from "../../src/server/preview/identity.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: number) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1] ?? d) : d; };
const PRS = opt("--prs", 2000);
const SIZE = opt("--size", 50);
const ORIGIN = args.includes("--origin") ? args[args.indexOf("--origin") + 1] : "https://atlas.redline.support";

let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

const main = async () => {
  const res = await fetch(`${ORIGIN}/docs.json`);
  const docs = Object.values((await res.json()).nodes) as any[];
  const titles = [...new Set(docs.map((d) => String(d.title ?? "")).filter((t) => t.trim()))];
  console.log(`live atlas: ${docs.length} docs, ${titles.length} distinct titles`);

  // How many independent swaps even produce a key? A pair whose titles share
  // too little yields none, and cannot form a campaign at all — this is the
  // rule's main safety property, so measure it first.
  let keyed = 0;
  const SAMPLE = 20000;
  for (let i = 0; i < SAMPLE; i++) if (titleSubstitution(pick(titles), pick(titles))) keyed++;
  console.log(`independent swaps that produce a substitution key at all: ${((100 * keyed) / SAMPLE).toFixed(2)}%`);

  // PR-sized batches of independent swaps: how often does the rule suppress one?
  let prsWithCampaign = 0;
  let suppressed = 0;
  const examples: string[] = [];
  for (let p = 0; p < PRS; p++) {
    const main_ = new Map<string, SwapNode>();
    const prev = new Map<string, SwapNode>();
    for (let i = 0; i < SIZE; i++) {
      const id = `d${i}`;
      main_.set(id, { id, doc_no: `A.${i}`, title: pick(titles), content: "x" });
      prev.set(id, { id, doc_no: `A.${i}`, title: pick(titles), content: "y" });
    }
    const members = renameCampaigns({ changed: [...main_.keys()], mainById: main_, previewById: prev });
    if (members.size) {
      prsWithCampaign++;
      suppressed += members.size;
      if (examples.length < 5) {
        const id = [...members][0];
        examples.push(`"${main_.get(id)!.title}" -> "${prev.get(id)!.title}"`);
      }
    }
  }
  console.log(
    `\nFALSE SUPPRESSION: ${PRS} simulated PRs of ${SIZE} independent swaps each ` +
    `(${PRS * SIZE} swaps total)\n` +
    `  PRs where the rule suppressed anything: ${prsWithCampaign} (${((100 * prsWithCampaign) / PRS).toFixed(2)}%)\n` +
    `  swaps wrongly spared: ${suppressed} of ${PRS * SIZE} (${((100 * suppressed) / (PRS * SIZE)).toFixed(3)}%)`,
  );
  for (const e of examples) console.log(`    e.g. ${e}`);

  // The benefit direction: a terminology pass across real sibling titles. A
  // family is the titles that share their first three words; the pass replaces
  // one common word in every member that has it. Every family and every word
  // pair is tried, and the outcome is given for the shipped bar AND the bars
  // either side of it, since the bar is what this measures.
  const families = new Map<string, string[]>();
  for (const t of titles) {
    const head = t.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
    const g = families.get(head);
    if (g) g.push(t);
    else families.set(head, [t]);
  }
  const WORDS = [["of", "for"], ["the", "each"], ["and", "plus"]];
  // by family size: [families, spared at bar 2, spared at bar 3, spared at bar 4]
  const bySize = new Map<number, [number, number, number, number]>();
  for (const fam of families.values()) {
    for (const [from, to] of WORDS) {
      const members = fam.filter((t) => new RegExp(`\\b${from}\\b`, "i").test(t));
      if (members.length < 2) continue;
      const keys = members.map((t) => titleSubstitution(t, t.replace(new RegExp(`\\b${from}\\b`, "gi"), to)));
      const count = new Map<string | null, number>();
      for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
      const sparedAt = (bar: number) => keys.every((k) => k !== null && (count.get(k) ?? 0) >= bar);
      const size = Math.min(members.length, 5);
      const row = bySize.get(size) ?? [0, 0, 0, 0];
      row[0]++;
      if (sparedAt(2)) row[1]++;
      if (sparedAt(3)) row[2]++;
      if (sparedAt(4)) row[3]++;
      bySize.set(size, row);
    }
  }
  console.log(`\nBENEFIT: a one-word terminology pass across real sibling titles (shipped bar: ${CAMPAIGN_MIN_DOCS})`);
  console.log(`  members   families   whole family spared at bar 2 / bar 3 / bar 4`);
  for (const [size, [n, s2, s3, s4]] of [...bySize].sort((x, y) => x[0] - y[0])) {
    console.log(`  ${(size === 5 ? "5+" : String(size)).padStart(7)}   ${String(n).padStart(8)}   ${String(s2).padStart(5)} / ${String(s3).padStart(5)} / ${String(s4).padStart(5)}`);
  }

  // The residual risk, stated rather than averaged away. The batches above draw
  // INDEPENDENT swaps, which is why they never collide. A CORRELATED mass
  // repurposing does: if several sibling documents are all repointed from one
  // entity to another in one PR, their titles take the identical substitution,
  // most of each title survives, and the rule spares every one of them.
  //
  // This is not a bug that can be tuned out — it is the rule's premise. At the
  // level of titles alone, "the Keel docs now hold the Obex docs" and "we
  // renamed Keel to Obex" are the same edit, and the rule deliberately takes
  // the benign reading. What separates them is the DISPLACED CONTENT, which is
  // why a member with a demonstrated relocation is still flagged. So the
  // exposure is precisely: a correlated mass repurposing whose old content
  // cannot be located anywhere in the diff.
  const victims = ["Whitelisting Of ALM Proxy For Keel", "Reporting Of ALM Proxy For Keel", "Staking Of ALM Proxy For Keel"];
  const advMain = new Map<string, SwapNode>(), advPrev = new Map<string, SwapNode>();
  victims.forEach((t, i) => {
    advMain.set(`d${i}`, { id: `d${i}`, doc_no: `A.${i}`, title: t, content: "x" });
    advPrev.set(`d${i}`, { id: `d${i}`, doc_no: `A.${i}`, title: t.replace("Keel", "Obex"), content: "y" });
  });
  const spared = renameCampaigns({ changed: [...advMain.keys()], mainById: advMain, previewById: advPrev }).size;
  console.log(`\nADVERSARIAL: ${victims.length} sibling docs all repointed Keel -> Obex in one PR`);
  console.log(`  rule spares: ${spared}/${victims.length} — a FALSE SUPPRESSION when these are real repurposings`);
  console.log(`  (mitigated only by relocationTarget: a member whose old content is found elsewhere is still flagged)`);
};

await main();
