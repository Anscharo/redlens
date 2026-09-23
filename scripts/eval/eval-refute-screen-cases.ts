// Cases for `pnpm eval:refute-screen` (eval-refute-screen.ts): every paragraph
// of the stored answers in eval-corpora/{evidence,fable} (baseline), the
// canonical planted mutations (eval-verifier-mutations.ts buildMutations), and
// the same tamper functions applied line by line inside each paragraph for
// more N on the name/number classes. Ported from the 2026-09-22 research run
// (docs/plans/jev-typesafe.md research round part 3) so the class split —
// value:contradictable / value:uncontradictable / entity / doc_no / ordinal —
// is the one the plan's numbers were reported in. Pure: no network.
import fs from "node:fs";
import path from "node:path";
import type { Indexes } from "../../src/server/retrieval/indexes.ts";
import type { EvidenceEntry } from "../../src/server/chat/verify/verifier.ts";
import { budgetEvidence } from "../../src/server/chat/verify/verifier.ts";
import { createParagraphSegmenter } from "../../src/server/chat/verify/paragraphs.ts";
import { findParamsMentioned } from "../../src/server/chat/verify/param-checks.ts";
import { statementsOf } from "../../src/server/chat/verify/refute-screen.ts";
import { atlasDescribe } from "../../src/server/chat/tools/tools.ts";
import { config } from "../../src/server/config.ts";
import { buildMutations, mutateNumber, mutateContradiction, type SavedRun } from "./eval-verifier-mutations.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const CORPORA = ["evidence", "fable"].map((d) => path.join(ROOT, "scripts", "eval", "eval-corpora", d));

// Baseline paragraphs adjudicated by hand as REAL defects in the stored answer
// (2026-09-22): signer totals 2/3/3 where the evidence edges sum to 5/5/5; the
// Demand Side Buffer called under-signed (<3) where evidence says 3 signers; the
// 7-signer high-value carve-out attributed to the 3-signer baseline.
export const TRUE_DEFECT = new Set(["bakeoff-multisig-security#b5", "bakeoff-multisig-security#b11", "multisig-security-review#b9"]);

export interface Case {
  id: string;
  run: string;
  set: "baseline" | "canonical" | "expanded";
  cls: string; // baseline | contradiction | number | enumeration | fabrication | ruling
  sub: string | null;
  paragraph: string;
  targetUnits: string[]; // statements carrying the planted defect (empty for baseline)
}

export function loadRuns(): SavedRun[] {
  return CORPORA.flatMap((dir) =>
    fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SavedRun),
  );
}

/** The production segmenter, fed the whole answer at once (same paragraphs as streaming). */
export function paragraphsOf(answer: string): string[] {
  const seg = createParagraphSegmenter();
  const out = seg.push(answer);
  const tail = seg.flush();
  if (tail) out.push(tail);
  return out;
}

// Production per-paragraph evidence (chat-orchestrator.ts paragraphEvidenceFor,
// single turn so no [E-prev]): schema + param rows the paragraph mentions + the
// turn's evidence under the verifier budget. BOTH arms read this.
let schema: EvidenceEntry | null = null;
export function prodEvidence(ix: Indexes, run: SavedRun, paragraph: string): EvidenceEntry[] {
  schema ??= { label: "[E0]", tool: "atlas_schema", args: "(live schema)", content: JSON.stringify(atlasDescribe(ix)) };
  const matches = findParamsMentioned(paragraph, ix);
  const ranked = [...matches]
    .sort((a, b) => ((a.row.owner ? 0 : 1) - (b.row.owner ? 0 : 1)) || b.row.name.length - a.row.name.length)
    .slice(0, 40);
  const ce: EvidenceEntry[] = ranked.length
    ? [{ label: "[E-const]", tool: "atlas_param_table", args: "(param table)", content: JSON.stringify(ranked.map(({ row }) => ({ name: row.name, value: row.value, unit: row.unit, owner: row.owner, doc_no: row.doc_no, uuid: row.uuid }))) }]
    : [];
  return [schema, ...ce, ...budgetEvidence(run.evidence, config.chatVerifierEvidenceMaxChars)];
}

const NUM = /(?<![0-9a-f-])\d+(?:,\d{3})*(?:\.\d+)?(?![0-9a-f-])/gi;
// Where the planted change landed, from a char diff of original vs mutated paragraph.
function locate(origPar: string, mutPar: string, evidenceText: string): string {
  if (!origPar) return "appended";
  let i = 0;
  while (i < origPar.length && origPar[i] === mutPar[i]) i++;
  const lineStart = mutPar.lastIndexOf("\n", i - 1) + 1;
  const lineEnd = mutPar.indexOf("\n", i) === -1 ? mutPar.length : mutPar.indexOf("\n", i);
  const line = mutPar.slice(lineStart, lineEnd);
  if (origPar.split("\n").includes(line)) return "duplicate";
  const col = i - lineStart;
  let s = col, e = col;
  while (s > 0 && /[\d,.]/.test(line[s - 1])) s--;
  while (e < line.length && /[\d,]/.test(line[e])) e++;
  if (!/\d/.test(line.slice(s, e))) return "entity";
  if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?$/.test(line.slice(0, s)) && /^\.(?:\s|\*\*)/.test(line.slice(e))) return "ordinal";
  let s0 = col;
  while (s0 > 0 && /\d/.test(line[s0 - 1])) s0--;
  if (/\bA\.(?:\d+\.)*$/.test(line.slice(0, s0))) return "doc_no";
  const origLine = origPar.split("\n")[mutPar.slice(0, lineStart).split("\n").length - 1] ?? "";
  const origTok = (origLine.slice(s).match(/^\d+(?:,\d{3})*(?:\.\d+)?/) ?? [""])[0].replace(/,/g, "");
  const ev = new Set((evidenceText.match(NUM) ?? []).map((n) => n.replace(/,/g, "")));
  return ev.has(origTok) ? "value:contradictable" : "value:uncontradictable";
}

export function buildAllCases(runs: SavedRun[], ix: Indexes): Case[] {
  const cases: Case[] = [];
  for (const run of runs) {
    const orig = paragraphsOf(run.answer);
    const origSet = new Set(orig);
    const origUnits = new Set(orig.flatMap(statementsOf));
    const evText = run.evidence.map((e) => e.content).join("\n");
    orig.forEach((p, i) => cases.push({ id: `${run.id}#b${i}`, run: run.id, set: "baseline", cls: "baseline", sub: null, paragraph: p, targetUnits: [] }));
    for (const mut of buildMutations(run, ix)) {
      if (mut.class === "unknown_uuid" || mut.class === "wrong_doc") continue; // deterministic checks' / the citation check's job
      const muts = paragraphsOf(mut.answer);
      const targets = muts.flatMap((p, j) => (origSet.has(p) ? [] : [{ p, origPar: j < orig.length ? orig[j] : "", units: statementsOf(p).filter((u) => !origUnits.has(u)) }]));
      targets.forEach((t, k) => {
        const loc0 = mut.class === "contradiction" || mut.class === "number" ? locate(t.origPar, t.p, evText) : null;
        // mutateContradiction only swaps a figure that occurs in the evidence: contradictable by construction.
        const loc = mut.class === "contradiction" && loc0?.startsWith("value") ? "value:contradictable" : loc0;
        const sub = t.units.length ? loc : `no-unit:${loc ?? mut.class}`;
        cases.push({ id: `${run.id}#${mut.class}${k}`, run: run.id, set: "canonical", cls: mut.class, sub, paragraph: t.p, targetUnits: t.units });
      });
    }
    // Expansion: the same tamper functions line by line; value/entity landings only, ≤3 per paragraph per class.
    const seen = new Set<string>();
    orig.forEach((p, i) => {
      const lines = p.split("\n");
      const kept: Record<string, number> = { number: 0, contradiction: 0 };
      lines.forEach((line, li) => {
        for (const cls of ["number", "contradiction"] as const) {
          if (kept[cls] >= 3) continue;
          const ml = cls === "number" ? mutateNumber(line) : mutateContradiction({ ...run, answer: line }, ix);
          if (!ml || ml === line) continue;
          const mp = [...lines.slice(0, li), ml, ...lines.slice(li + 1)].join("\n");
          if (seen.has(mp)) continue;
          const sub0 = locate(p, mp, evText);
          const sub = cls === "contradiction" && sub0.startsWith("value") ? "value:contradictable" : sub0;
          if (!(sub.startsWith("value") || sub === "entity")) continue;
          const units = statementsOf(mp).filter((u) => !statementsOf(p).includes(u));
          if (!units.length) continue;
          seen.add(mp);
          kept[cls]++;
          cases.push({ id: `${run.id}#x${cls}${i}.${li}`, run: run.id, set: "expanded", cls, sub, paragraph: mp, targetUnits: units });
        }
      });
    });
  }
  return cases;
}
