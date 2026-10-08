// Printing for the vote-evidence eval: one score table per task, a threshold
// sweep per decision model, and every case where an arm disagrees with gold
// (./eval-vote-evidence-disagreements.ts).

import { disagreements } from "./eval-vote-evidence-disagreements.ts";
import { jevPoll, scorePoll, scoreSubject, jevSubject, type SubjectLabel } from "./eval-vote-evidence-score.ts";

export interface SubjectRow {
  key: string;
  docNo: string;
  slice: "real" | "swapped";
  vote: string;
  gold: string;
  heuristic: SubjectLabel;
  /** One entry per decision model, keyed by its arm name. */
  decisions: Record<string, { anchor: number | null; carried: number | null; label: SubjectLabel }>;
  llm: { label: SubjectLabel; quote: string } | null;
}

export interface PollRow {
  key: string;
  docNo: string;
  gold: string;
  acceptable: string[];
  /** Candidate poll files in p0…pK order, as the judges saw them. */
  candidates?: string[];
  heuristic: string;
  lexical: string;
  /** Undefined when the atlas checkout has no history. */
  history?: string;
  /** One entry per decision model, keyed by its arm name. */
  decisions: Record<string, { nouls: Record<string, number | null> | null; pick: string | null }>;
  /** Undefined when the LLM arm did not run; null when it answered nothing usable. */
  llm?: string | null;
}

export interface Report {
  decisionModels: string[];
  llmModel: string;
  tau: number;
  staleGold: string[];
  prefilter: { topK: string; window: string };
  subject: SubjectRow[];
  poll: PollRow[];
}

const pct = (x: number | null) => (x === null ? "  —  " : `${(x * 100).toFixed(0).padStart(3)}%`);

function subjectTable(rows: SubjectRow[], slice: "real" | "swapped"): void {
  const scoped = rows.filter((r) => r.slice === slice && r.gold !== "unlabeled");
  if (!scoped.length) return;
  console.log(`\nsubject · ${slice} (${scoped.length} labeled)\n  arm        accuracy  coverage  caught-no  false-alarms`);
  const arms: Array<[string, (r: SubjectRow) => SubjectLabel | undefined]> = [
    ["heuristic", (r) => r.heuristic],
    ...decisionArms(scoped).map((a): [string, (r: SubjectRow) => SubjectLabel | undefined] => [a, (r) => r.decisions[a]?.label]),
    ["llm", (r) => r.llm?.label],
  ];
  for (const [name, get] of arms) {
    if (scoped.some((r) => get(r) === undefined)) continue;
    const s = scoreSubject(scoped.map((r) => ({ gold: r.gold, pred: get(r)! })));
    console.log(`  ${name.padEnd(10)} ${pct(s.accuracy)}      ${pct(s.coverage)}     ${s.caught.padEnd(9)}  ${s.falseAlarms}`);
  }
}

const TAUS = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

/** Decision arms present on every row, in first-seen order. */
function decisionArms(rows: Array<{ decisions: Record<string, unknown> }>): string[] {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r.decisions ?? {})))];
  return names.filter((a) => rows.every((r) => r.decisions?.[a] !== undefined));
}

function subjectSweeps(rows: SubjectRow[]): void {
  const scoped = rows.filter((r) => r.gold === "yes" || r.gold === "no");
  for (const arm of decisionArms(scoped)) {
    const line = TAUS.map((tau) => {
      const s = scoreSubject(scoped.map((r) => ({ gold: r.gold, pred: jevSubject(r.decisions[arm].anchor, r.decisions[arm].carried, tau) })));
      return `${tau}:${pct(s.accuracy).trim()}`;
    });
    console.log(`  ${arm} carried threshold sweep (yes/no rows, both slices): ${line.join("  ")}`);
  }
}

function pollTable(rows: PollRow[], r: Report): void {
  const scoped = rows.filter((x) => x.gold !== "unlabeled");
  if (!scoped.length) return;
  console.log(`\npoll (${scoped.length} labeled; prefilter kept a gold poll in ${r.prefilter.topK} top-K, ${r.prefilter.window} in window)`);
  console.log("  arm        accuracy  found    false-matches  errors");
  const arms: Array<[string, (x: PollRow) => string | null | undefined]> = [
    ["heuristic", (x) => x.heuristic],
    ["lexical", (x) => x.lexical],
    ["history", (x) => x.history],
    ...decisionArms(scoped).map((a): [string, (x: PollRow) => string | null | undefined] => [a, (x) => x.decisions[a]?.pick]),
    ["llm", (x) => x.llm],
  ];
  for (const [name, get] of arms) {
    if (scoped.some((x) => get(x) === undefined)) continue;
    const s = scorePoll(scoped.map((x) => ({ acceptable: x.acceptable, pred: get(x) ?? null })));
    console.log(`  ${name.padEnd(10)} ${pct(s.accuracy)}      ${s.found.padEnd(7)}  ${s.falseMatches.padEnd(13)}  ${s.errors}`);
  }
  pollSweeps(scoped);
}

/** Each decision arm's accuracy across TAUS, re-picked from the stored Nouls so the sweeps cost no calls. */
function pollSweeps(scoped: PollRow[]): void {
  for (const arm of decisionArms(scoped)) {
    const sweep = TAUS.map((tau) => {
      const rows = scoped.map((x) => ({ acceptable: x.acceptable, pred: jevPoll(candidatesOf(x), x.decisions[arm].nouls, tau) }));
      return `${tau}:${pct(scorePoll(rows).accuracy).trim()}`;
    });
    console.log(`  ${arm} threshold sweep: ${sweep.join("  ")}`);
  }
}

// jevPoll needs each candidate's id and file; a row keeps them as the Noul keys
// and the candidate files it was judged over.
function candidatesOf(x: PollRow) {
  return { candidates: (x.candidates ?? []).map((file, i) => ({ id: `p${i}`, file })) } as Parameters<typeof jevPoll>[0];
}

export function printReport(r: Report): void {
  console.log(`decision=${r.decisionModels.join(",") || "off"} llm=${r.llmModel || "off"} tau=${r.tau}`);
  if (r.staleGold.length) console.log(`gold rows whose claim the atlas no longer holds (rewritten?): ${r.staleGold.length}`);
  const unlabeled = [...r.subject, ...r.poll].filter((x) => x.gold === "unlabeled").length;
  if (unlabeled) console.log(`cases without gold (new atlas claims; label them in eval-corpora/vote-evidence-gold.json): ${unlabeled}`);
  subjectTable(r.subject, "real");
  subjectTable(r.subject, "swapped");
  subjectSweeps(r.subject);
  pollTable(r.poll, r);
  disagreements(r);
  console.log("\nfull rows → .cache/eval-vote-evidence.json");
}
