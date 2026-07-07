// OEA duty assessment — LLM-drafted weak/mid/strong ratings for every task the
// Operational Executor Agent performs, against docs/oea-assessment-rubric.md.
// Infrequent + local + incremental: a task is only (re)assessed when its
// assessed text, its doc, or the rubric changed (rubric §Process). Output is
// the committed, human-reviewed artifact public/oea-assessment.json.
//
//   pnpm oea:assess --dry-run            stats + sample prompt, zero API calls
//   pnpm oea:assess --limit 5            assess the first 5 queued tasks
//   pnpm oea:assess --only <uuid|key>    one task
//   pnpm oea:assess --force              reassess everything
//   pnpm oea:assess --model <id>         default google/gemma-4-26b-a4b-it
//
// Runs under bun (auto-loads OPENROUTER_API_KEY from .env.local). Requires
// public/docs.json + public/relations.json (pnpm build:index && pnpm build:graph).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AtlasNode, RelationEdge, GraphEntity } from "../../src/types";
import { enumerateOeaTasks, normalizeAssessedText, type OeaTask } from "../../src/lib/oeaTasks";
import type { Assessment, OeaAssessmentArtifact, OeaAssessmentEntry } from "../../src/lib/oeaAssessment";
import { getClient } from "../../src/server/llm";
import { loadRubric, buildSystemPrompt, buildUserPrompt, MECHANISM_CATALOG } from "./assess-oea-prompt";
import { validateAssessment, downgradeToWeak } from "./assess-oea-validate";
import { buildPrefixIndex, withRetry } from "./assess-common";

const ROOT = path.resolve(import.meta.dir, "../..");
const ARTIFACT_PATH = path.join(ROOT, "public", "oea-assessment.json");

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : undefined; };
const DRY = flag("dry-run");
const FORCE = flag("force");
const ONLY = opt("only");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const MODEL = opt("model") ?? "google/gemma-4-26b-a4b-it";

const quoteHashOf = (t: OeaTask) =>
  crypto.createHash("sha256").update(normalizeAssessedText(t.assessedText)).digest("hex").slice(0, 16);

// --- load artifacts + enumerate the task universe
const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as
  { atlasCommit: string | null; nodes: Record<string, AtlasNode> };
const docs = docsFile.nodes;
const relations = JSON.parse(fs.readFileSync(path.join(ROOT, "public/relations.json"), "utf8")) as
  { entities: GraphEntity[]; edges: RelationEdge[] };
const participants = relations.entities.filter((e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive");
const tasks = enumerateOeaTasks(
  { docs, byParent: new Map(), docNoToId: new Map(), atlasCommit: docsFile.atlasCommit },
  { participants, instances: [], invocations: [], primitives: [], edges: relations.edges },
);

const rubric = loadRubric();
const badCatalog = MECHANISM_CATALOG.filter((m) => !docs[m.uuid]);
if (badCatalog.length) {
  console.error("mechanism catalog uuids missing from docs.json:", badCatalog.map((m) => m.uuid));
  process.exit(1);
}

const existing: OeaAssessmentArtifact = fs.existsSync(ARTIFACT_PATH)
  ? JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"))
  : { rubricVersion: rubric.version, atlasCommit: null, model: MODEL, assessments: [] };
const existingByKey = new Map(existing.assessments.map((a) => [a.taskKey, a]));

type Status = "fresh" | "stale" | "new";
const statusOf = (t: OeaTask): Status => {
  const e = existingByKey.get(t.taskKey);
  if (!e) return "new";
  const docHash = docs[t.uuid]?.contentHash;
  return e.quoteHash === quoteHashOf(t) && e.rubricVersion === rubric.version && e.docContentHash === docHash
    ? "fresh"
    : "stale";
};

const taskKeys = new Set(tasks.map((t) => t.taskKey));
const orphans = existing.assessments.filter((a) => !taskKeys.has(a.taskKey));
const statuses = new Map(tasks.map((t) => [t.taskKey, statusOf(t)]));
let queue = tasks.filter((t) => FORCE || statuses.get(t.taskKey) !== "fresh");
if (ONLY) queue = queue.filter((t) => t.uuid.startsWith(ONLY) || t.taskKey === ONLY);
queue = queue.slice(0, LIMIT);

// --- stats (always printed; the whole story for --dry-run)
const count = <T,>(xs: T[], f: (x: T) => string) =>
  xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map<string, number>());
console.log(`tasks: ${tasks.length} · by category:`, Object.fromEntries(count(tasks, (t) => t.category)));
console.log(`by source:`, Object.fromEntries(count(tasks, (t) => t.sources.join("+"))));
console.log(`snippet-assessed (no verbatim quote): ${tasks.filter((t) => !t.quoted).length} · [automated]: ${tasks.filter((t) => t.automated).length}`);
console.log(`status: ${JSON.stringify(Object.fromEntries(count([...statuses.values()], (s) => s)))} · orphans to drop: ${orphans.length}`);
console.log(`rubric ${rubric.version} · model ${MODEL} · queued for assessment: ${queue.length}`);

if (DRY) {
  if (queue[0]) {
    const sys = buildSystemPrompt(rubric.text);
    const usr = buildUserPrompt(queue[0], docs);
    console.log(`\n— sample prompt (${queue[0].docNo} ${queue[0].title}; system ${sys.length} chars, user ${usr.length} chars) —\n`);
    console.log(usr);
  }
  process.exit(0);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (.env.local) — cannot assess.");
  process.exit(1);
}

// --- LLM loop: sequential (the :free variants rate-limit hard), transport
// retries with backoff, then up to 3 corrective retries on validation errors.
const docIds = new Set(Object.keys(docs));
const byPrefix = buildPrefixIndex(docIds);
const systemPrompt = buildSystemPrompt(rubric.text);

async function assess(task: OeaTask): Promise<Assessment | null> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserPrompt(task, docs) },
  ];
  let citationFallback: Assessment | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    // OpenRouter can return 200 with an error payload and no choices (e.g.
    // :free rate limits) — throw inside withRetry so it backs off and retries.
    const raw = await withRetry(async () => {
      const res = await getClient().chat.completions.create({ model: MODEL, messages, temperature: 0 });
      const content = res.choices?.[0]?.message?.content;
      if (!content) throw new Error(`no choices in response: ${JSON.stringify(res).slice(0, 200)}`);
      return content;
    });
    const v = validateAssessment(raw, docIds, byPrefix);
    if (v.ok) return v.value;
    if (v.citationOnly && v.value) citationFallback = v.value;
    console.warn(`  invalid (attempt ${attempt + 1}): ${v.error}`);
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your response failed validation: ${v.error}. Reply again with ONLY the corrected JSON object.` },
    );
  }
  return citationFallback ? downgradeToWeak(citationFallback) : null;
}

const merged = new Map(existingByKey);
for (const o of orphans) {
  merged.delete(o.taskKey);
  console.log(`orphan dropped: ${o.docNo} ${o.title}`);
}

const writeArtifact = () => {
  const artifact: OeaAssessmentArtifact = {
    rubricVersion: rubric.version,
    atlasCommit: docsFile.atlasCommit,
    model: MODEL,
    assessments: [...merged.values()].sort((a, b) => a.docNo.localeCompare(b.docNo, undefined, { numeric: true })),
  };
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact.assessments.length;
};

let done = 0, skipped = 0;
for (const task of queue) {
  done++;
  const a = await assess(task);
  if (!a) {
    skipped++;
    console.warn(`[${done}/${queue.length}] ${task.docNo} ${task.title} — SKIPPED (stays queued)`);
    continue;
  }
  const entry: OeaAssessmentEntry = {
    taskKey: task.taskKey, uuid: task.uuid, docNo: task.docNo, title: task.title,
    category: task.category, sources: task.sources, agents: task.agents,
    assessedText: task.assessedText, quoted: task.quoted, automated: task.automated,
    quoteHash: quoteHashOf(task), docContentHash: docs[task.uuid]?.contentHash,
    model: MODEL, rubricVersion: rubric.version, ...a,
  };
  merged.set(task.taskKey, entry);
  console.log(`[${done}/${queue.length}] ${task.docNo} ${task.title} → precision:${a.precision.rating} incentives:${a.incentives.rating}`);
  if (done % 10 === 0) writeArtifact(); // checkpoint — a mid-run failure loses ≤10 ratings
}

const total = writeArtifact();
console.log(`\nwrote ${ARTIFACT_PATH}: ${total} assessments (${skipped} skipped)`);
