// The judge half of eval:summary: probes, retention grading and the fabrication
// check. Every judge call is cached on disk by the hash of its inputs.
import fs from "node:fs";
import path from "node:path";
import { callWithTimeout, makeOpenrouterJson, type JsonCall } from "../../src/server/chat/llm.ts";
import { renderPrefix } from "../../src/server/chat/context-summary.ts";
import { parseJsonish } from "../../src/server/chat/verify/slice-json.ts";
import { shortHash, type Thread } from "./eval-summary-data.ts";

export const CACHE_DIR = path.resolve(import.meta.dir, "../../.cache/eval-summary");
const JUDGE_TIMEOUT_MS = 600_000;
const JUDGE_MAX_TOKENS = 16_000;

export interface Probe { q: string; ref: string }
export type Grade = "correct" | "partial" | "missing" | "wrong";
export const judgeUsage = { input: 0, output: 0, calls: 0 };

export const call: JsonCall = makeOpenrouterJson({}, "eval-summary");

export function cachedFile<T>(sub: string, key: string): { get(): T | null; put(v: T): T } {
  const file = path.join(CACHE_DIR, sub, `${key}.json`);
  return {
    get: () => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null),
    put: (v) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(v));
      return v;
    },
  };
}

async function ask(judge: string, system: string, user: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callWithTimeout(call, { model: judge, messages: [{ role: "system", content: system }, { role: "user", content: user }], maxTokens: JUDGE_MAX_TOKENS }, JUDGE_TIMEOUT_MS);
    judgeUsage.input += res.usage.input;
    judgeUsage.output += res.usage.output;
    judgeUsage.calls++;
    const parsed = parseJsonish(res.text);
    if (parsed) return parsed as Record<string, unknown>;
  }
  throw new Error("judge returned no JSON");
}

const PROBE_SYSTEM = `You write test questions about a chat transcript. Write 6 to 12 probe questions that a reader could answer only if they kept the transcript's details: specific facts and figures stated, which atlas documents were cited (titles and doc numbers), what the user asked for or preferred, and unresolved follow-ups. Each question must be answerable from the transcript alone. Give each a short reference answer. Respond with STRICT JSON: {"probes":[{"q":"...","ref":"..."}]}`;

export async function getProbes(judge: string, thread: Thread, prefixText: string): Promise<Probe[]> {
  const c = cachedFile<Probe[]>("probes", shortHash(`${judge}\n${prefixText}`));
  const hit = c.get();
  if (hit) return hit;
  const out = await ask(judge, PROBE_SYSTEM, prefixText);
  const probes = ((out.probes as Probe[] | undefined) ?? []).filter((p) => p?.q && p?.ref).slice(0, 12);
  if (probes.length < 3) throw new Error(`too few probes for ${thread.id}`);
  return c.put(probes);
}

const ANSWER_SYSTEM = `Answer each question using ONLY the summary text you are given. If the summary does not say, answer exactly NOT IN SUMMARY. Respond with STRICT JSON: {"answers":["...","..."]} with one answer per question, in order.`;
const GRADE_SYSTEM = `Grade each answer against its reference answer. "correct": same facts. "partial": some of the facts, none contradicted. "missing": the answer says it is not in the summary or gives nothing. "wrong": contradicts the reference. Respond with STRICT JSON: {"grades":["correct","partial",...]} in order.`;

export async function gradeRetention(judge: string, summary: string, probes: Probe[]): Promise<Grade[]> {
  const c = cachedFile<Grade[]>("grades", shortHash(`${judge}\n${summary}\n${JSON.stringify(probes)}`));
  const hit = c.get();
  if (hit) return hit;
  const qs = probes.map((p, i) => `${i + 1}. ${p.q}`).join("\n");
  const ans = ((await ask(judge, ANSWER_SYSTEM, `Summary:\n${summary}\n\nQuestions:\n${qs}`)).answers as unknown[]) ?? [];
  const pairs = probes.map((p, i) => `${i + 1}. Q: ${p.q}\nReference: ${p.ref}\nAnswer: ${String(ans[i] ?? "NOT IN SUMMARY")}`).join("\n\n");
  const raw = ((await ask(judge, GRADE_SYSTEM, pairs)).grades as string[]) ?? [];
  const ok = new Set(["correct", "partial", "missing", "wrong"]);
  return c.put(probes.map((_, i) => (ok.has(raw[i]) ? (raw[i] as Grade) : "missing")));
}

const FAB_SYSTEM = `You check a summary against the transcript it summarizes. List each statement in the summary that the transcript does not support: invented documents, wrong figures, claims never made. Do not list omissions. Respond with STRICT JSON: {"unsupported":["statement", ...]} (empty array if none).`;

export async function findFabrications(judge: string, summary: string, prefixText: string): Promise<string[]> {
  const c = cachedFile<string[]>("fab", shortHash(`${judge}\n${summary}\n${prefixText}`));
  const hit = c.get();
  if (hit) return hit;
  const out = await ask(judge, FAB_SYSTEM, `Transcript:\n${prefixText}\n\n=====\nSummary:\n${summary}`);
  return c.put(((out.unsupported as unknown[]) ?? []).map(String));
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const DOC_NO_RE = /\b(?:A\.\d+(?:\.\d+)+|NR-\d+)\b/g;

/** Identifiers in the summary that never occur in the text it was written from. */
export function unmatchedIds(summary: string, prefixText: string): string[] {
  const hay = prefixText.toLowerCase();
  const ids = new Set([...(summary.match(UUID_RE) ?? []), ...(summary.match(DOC_NO_RE) ?? [])]);
  return [...ids].filter((id) => !hay.includes(id.toLowerCase()));
}

export const prefixTextOf = (t: Thread): string => renderPrefix(null, t.rows);
