// Vote-evidence second-voice eval: would a decision model (Jev, or any model
// OpenRouter serves on its /systemone decisions endpoint) or an LLM, beside the
// shipped heuristic matcher (src/lib/votes/), judge Stale Dates claims better?
// Handoff and how to read the result: docs/research/vote-matching/second-voice-eval.md.
//
//   pnpm eval:vote-evidence                                  # heuristic + lexical, and Jev when OPENROUTER_API_KEY is set
//   pnpm eval:vote-evidence --decision-models typesafe/jev-1.13,openai/gpt-6-luna-decisions
//   pnpm eval:vote-evidence --llm-model <openrouter-id>      # + one chat-completions LLM arm
//   pnpm eval:vote-evidence --poll-dir ../polls --task poll  # a local polls checkout; one task only
//
// Flags: --task subject|poll|both · --decision-models <id,id> (default
// CHAT_JEV_MODEL; each asks the same typed questions) · --llm-model <id> ·
// --k <n> poll candidates per claim (8) · --tau <p> decision yes threshold (0.5) · --no-swap · --poll-dir <dir> · --atlas-dir <dir> (the
// submodule; the history arm needs its full history) · --concurrency <n> (4).
//
// Every model answer is cached under .cache/eval-vote-evidence/
// (./eval-vote-evidence-models.ts), so a rerun makes no calls and prints the
// same numbers.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { config } from "../../src/server/config.ts";
import { mapPool } from "../../src/server/pool.ts";
import { checkSubject, documentAddresses } from "../../src/lib/votes/subject.ts";
import { buildVoteIndex } from "../../src/lib/votes/vote-index.ts";
import type { VotesArtifact } from "../../src/lib/votes/types.ts";
import { repoTree } from "../lib/votes/fetch.ts";
import { readPollBodies } from "../lib/votes/record.ts";
import { buildCases, type Gold, type PollCase, type SubjectCase } from "./eval-vote-evidence-cases.ts";
import * as Q from "./eval-vote-evidence-judges.ts";
import * as S from "./eval-vote-evidence-score.ts";
import { firstPr, historyHead, pickaxeNeedle, pollForPr } from "../../src/server/vote-evidence/history.ts";
import * as R from "../../src/server/vote-evidence/requests.ts";
import { modelArms } from "./eval-vote-evidence-models.ts";
import { printReport, type PollRow, type SubjectRow } from "./eval-vote-evidence-report.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const CACHE = path.join(ROOT, ".cache", "eval-vote-evidence");
const { values: flags } = parseArgs({
  options: {
    task: { type: "string", default: "both" },
    "decision-models": { type: "string" },
    "llm-model": { type: "string" },
    k: { type: "string", default: "8" },
    tau: { type: "string", default: "0.5" },
    "no-swap": { type: "boolean", default: false },
    "poll-dir": { type: "string" },
    "atlas-dir": { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
});
const DECISION_MODELS = config.openrouterApiKey
  ? (flags["decision-models"] ?? config.chatJevModel).split(",").map((m) => m.trim()).filter(Boolean)
  : [];
const LLM_MODEL = config.openrouterApiKey ? (flags["llm-model"] ?? "") : "";
const TAU = Number(flags.tau);
const CONC = Number(flags.concurrency);
const ATLAS_DIR = path.resolve(flags["atlas-dir"] ?? path.join(ROOT, "vendor/next-gen-atlas"));
const HISTORY = (await historyHead(ATLAS_DIR)) !== null;
const { decideAll, llm } = modelArms(CACHE, DECISION_MODELS, LLM_MODEL);

async function subjectRow(c: SubjectCase, slice: "real" | "swapped", heuristic: S.SubjectLabel): Promise<SubjectRow> {
  const d = await decideAll(R.subjectState(c), R.SUBJECT_QUESTIONS, "vote-evidence-subject");
  const l = await llm(Q.subjectMessages(c));
  const la = l ? Q.parseLlmSubject(l.text) : null;
  const llmLabel: S.SubjectLabel | null = !LLM_MODEL ? null : !la ? "error" : la.anchor ? "anchor" : la.carried === "unclear" ? "abstain" : la.carried;
  return {
    key: c.key, docNo: c.docNo, slice, vote: c.vote.file, gold: c.gold?.label ?? "unlabeled", heuristic,
    decisions: Object.fromEntries(
      Object.entries(d).map(([arm, n]) => [arm, { anchor: n?.anchor ?? null, carried: n?.carried ?? null, label: S.jevSubject(n?.anchor ?? null, n?.carried ?? null, TAU) }]),
    ),
    llm: llmLabel === null ? null : { label: llmLabel, quote: la?.quote ?? "" },
  };
}

async function pollRow(c: PollCase, fileByTitle: Map<string, string>, bodies: Map<string, string>): Promise<PollRow> {
  const d = c.candidates.length
    ? await decideAll(R.pollState(c), R.pollQuestions(c), "vote-evidence-poll")
    : Object.fromEntries(DECISION_MODELS.map((m) => [S.armName(m), {}]));
  const l = c.candidates.length ? await llm(Q.pollMessages(c)) : { text: '{"match":"none"}' };
  const ids = c.candidates.map((p) => p.id);
  const pick = (id: string | null) => (id === null || id === "none" ? id : (c.candidates.find((p) => p.id === id)?.file ?? null));
  return {
    key: c.key, docNo: c.docNo, gold: c.gold?.label ?? "unlabeled", acceptable: c.gold?.authorising ?? [], candidates: c.candidates.map((p) => p.file),
    heuristic: S.heuristicPoll(c, fileByTitle), lexical: c.candidates[0]?.file ?? "none",
    history: HISTORY ? (pollForPr(await firstPr(pickaxeNeedle(c.claim), ATLAS_DIR), bodies) ?? "none") : undefined,
    decisions: Object.fromEntries(Object.entries(d).map(([arm, n]) => [arm, { nouls: n, pick: S.jevPoll(c, n, TAU) }])),
    llm: LLM_MODEL ? pick(l ? Q.parseLlmPoll(l.text, ids) : null) : undefined,
  };
}

async function main(): Promise<void> {
  const { docs, artifact, gold, bodies } = await loadInputs();
  const cases = buildCases(docs, artifact, bodies, gold, { today: new Date(), k: Number(flags.k) });
  const index = buildVoteIndex(artifact);
  if (!HISTORY) console.log(`history arm off: ${ATLAS_DIR} has no full git history (run \`pnpm pull-atlas\`, or pass --atlas-dir)`);
  const decisionArms = DECISION_MODELS.map((m) => `, ${S.armName(m)} (${m})`).join("");
  console.log(`arms: heuristic, lexical${HISTORY ? ", history" : ""}${decisionArms}${LLM_MODEL ? `, llm (${LLM_MODEL})` : ""}`);
  const subject = flags.task === "poll" ? [] : await runSubject(cases.subject, artifact, index, docs);
  const fileByTitle = new Map(artifact.polls.map((p) => [`${p.date}|${p.title}`, p.file]));
  const poll = flags.task === "subject" ? [] : await mapPool(cases.poll, CONC, (c) => pollRow(c, fileByTitle, bodies));
  const out = { generatedAt: new Date().toISOString(), decisionModels: DECISION_MODELS, llmModel: LLM_MODEL, tau: TAU, staleGold: cases.staleGold, prefilter: S.prefilterRecall(cases.poll), subject, poll };
  fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, ".cache/eval-vote-evidence.json"), JSON.stringify(out, null, 2));
  printReport(out);
}

/** The built atlas, the vote record, the gold labels and, unless only the subject task runs, every poll body. */
async function loadInputs() {
  const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
  const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, "public/votes.json"), "utf8")) as VotesArtifact;
  if (artifact.executives.some((e) => e.sections.some((s) => typeof s.text !== "string"))) {
    throw new Error("public/votes.json predates section text; run `pnpm votes:sync` first");
  }
  const gold = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "eval-corpora/vote-evidence-gold.json"), "utf8")) as Gold;
  const tree = flags.task === "subject" ? null : await repoTree("polls", flags["poll-dir"]);
  const bodies = tree ? readPollBodies(tree.root) : new Map<string, string>();
  tree?.cleanup();
  return { docs, artifact, gold, bodies };
}

async function runSubject(cases: SubjectCase[], artifact: VotesArtifact, index: ReturnType<typeof buildVoteIndex>, docs: Record<string, { content: string }>): Promise<SubjectRow[]> {
  const real = await mapPool(cases, CONC, (c) => subjectRow(c, "real", S.heuristicSubject(c)));
  if (flags["no-swap"]) return real;
  const swaps = cases.flatMap((c) => {
    if (c.gold?.label !== "yes" || !c.claim.vote) return [];
    const other = S.swapExecutive(c, artifact.executives, c.gold.evidence);
    if (!other) return [];
    const text = index.executives.find((x) => x.date === other.date && x.title === other.title)?.text ?? "";
    const h = checkSubject(c.claim.vote.subject, text, index.corpus, documentAddresses(docs[c.docId]?.content ?? "")).verdict;
    const label: S.SubjectLabel = h === "found" ? "yes" : h === "missing" ? "no" : "abstain";
    return [{ c: { ...c, key: `${c.key}#swap`, vote: other, gold: { ...c.gold, label: "no" as const } }, label }];
  });
  return [...real, ...(await mapPool(swaps, CONC, (s) => subjectRow(s.c, "swapped", s.label)))];
}

await main();
