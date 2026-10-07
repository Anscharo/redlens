// Printing for the vote-evidence eval: one score table per task, the Jev
// threshold sweep, and every case where an arm disagrees with gold.

import { jevPoll, scorePoll, scoreSubject, jevSubject, type SubjectLabel } from "./eval-vote-evidence-score.ts";

export interface SubjectRow {
  key: string;
  docNo: string;
  slice: "real" | "swapped";
  vote: string;
  gold: string;
  heuristic: SubjectLabel;
  jev: { anchor: number | null; carried: number | null; label: SubjectLabel } | null;
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
  jev: { nouls: Record<string, number | null> | null; pick: string | null } | null;
  /** Undefined when the LLM arm did not run; null when it answered nothing usable. */
  llm?: string | null;
}

interface Report {
  jevModel: string;
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
    ["jev", (r) => r.jev?.label],
    ["llm", (r) => r.llm?.label],
  ];
  for (const [name, get] of arms) {
    if (scoped.some((r) => get(r) === undefined)) continue;
    const s = scoreSubject(scoped.map((r) => ({ gold: r.gold, pred: get(r)! })));
    console.log(`  ${name.padEnd(10)} ${pct(s.accuracy)}      ${pct(s.coverage)}     ${s.caught.padEnd(9)}  ${s.falseAlarms}`);
  }
}

function jevSweep(rows: SubjectRow[]): void {
  const scoped = rows.filter((r) => r.jev && (r.gold === "yes" || r.gold === "no"));
  if (!scoped.length) return;
  const line = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((tau) => {
    const s = scoreSubject(scoped.map((r) => ({ gold: r.gold, pred: jevSubject(r.jev!.anchor, r.jev!.carried, tau) })));
    return `${tau}:${pct(s.accuracy).trim()}`;
  });
  console.log(`  jev carried threshold sweep (yes/no rows, both slices): ${line.join("  ")}`);
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
    ["jev", (x) => x.jev?.pick],
    ["llm", (x) => x.llm],
  ];
  for (const [name, get] of arms) {
    if (scoped.some((x) => get(x) === undefined)) continue;
    const s = scorePoll(scoped.map((x) => ({ acceptable: x.acceptable, pred: get(x) ?? null })));
    console.log(`  ${name.padEnd(10)} ${pct(s.accuracy)}      ${s.found.padEnd(7)}  ${s.falseMatches.padEnd(13)}  ${s.errors}`);
  }
  if (!scoped.some((x) => x.jev)) return;
  // Re-picks from the stored Nouls, so the sweep costs no calls.
  const sweep = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((tau) => {
    const rows = scoped.map((x) => ({ acceptable: x.acceptable, pred: jevPoll(candidatesOf(x), x.jev!.nouls, tau) }));
    return `${tau}:${pct(scorePoll(rows).accuracy).trim()}`;
  });
  console.log(`  jev threshold sweep: ${sweep.join("  ")}`);
}

// jevPoll needs each candidate's id and file; a row keeps them as the Noul keys
// and the candidate files it was judged over.
function candidatesOf(x: PollRow) {
  return { candidates: (x.candidates ?? []).map((file, i) => ({ id: `p${i}`, file })) } as Parameters<typeof jevPoll>[0];
}

function disagreements(r: Report): void {
  console.log("\ndisagreements with gold");
  for (const x of r.subject.filter((x) => x.gold !== "unlabeled")) {
    const preds = { heuristic: x.heuristic, jev: x.jev?.label, llm: x.llm?.label };
    const off = Object.entries(preds).filter(([, p]) => p !== undefined && p !== x.gold && p !== "abstain");
    if (off.length) console.log(`  subject ${x.slice} ${x.docNo} ${x.key.slice(0, 8)}… gold=${x.gold} ${off.map(([a, p]) => `${a}=${p}`).join(" ")} (${x.vote})`);
  }
  for (const x of r.poll.filter((x) => x.gold !== "unlabeled")) {
    const want = x.acceptable.length ? x.acceptable : ["none"];
    const off = Object.entries({ heuristic: x.heuristic, lexical: x.lexical, history: x.history, jev: x.jev?.pick, llm: x.llm }).filter(([, p]) => p !== undefined && !want.includes(String(p)));
    if (off.length) console.log(`  poll ${x.docNo} ${x.key.slice(0, 8)}… want=${want.join("|")} ${off.map(([a, p]) => `${a}=${p}`).join(" ")}`);
  }
}

export function printReport(r: Report): void {
  console.log(`jev=${r.jevModel || "off"} llm=${r.llmModel || "off"} tau=${r.tau}`);
  if (r.staleGold.length) console.log(`gold rows whose claim the atlas no longer holds (rewritten?): ${r.staleGold.length}`);
  const unlabeled = [...r.subject, ...r.poll].filter((x) => x.gold === "unlabeled").length;
  if (unlabeled) console.log(`cases without gold (new atlas claims; label them in eval-corpora/vote-evidence-gold.json): ${unlabeled}`);
  subjectTable(r.subject, "real");
  subjectTable(r.subject, "swapped");
  jevSweep(r.subject);
  pollTable(r.poll, r);
  disagreements(r);
  console.log("\nfull rows → .cache/eval-vote-evidence.json");
}
