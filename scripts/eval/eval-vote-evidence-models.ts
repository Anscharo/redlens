// The model arms of the vote-evidence eval (./eval-vote-evidence.ts): every
// decision model asked the same typed questions, and one chat-completions LLM.
// Each answer is cached on disk under the model and the exact request, so a
// rerun makes no calls; failed calls are not cached.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { askJev, noulOf, type JevQuestion } from "../../src/server/jev.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import type { Msg } from "./eval-vote-evidence-judges.ts";
import { armName } from "./eval-vote-evidence-score.ts";

export interface ModelArms {
  /** Each decision model's Nouls over the same request, keyed by its arm name. */
  decideAll(state: unknown, questions: Record<string, JevQuestion>, lane: string): Promise<Record<string, Record<string, number | null> | null>>;
  /** The LLM's reply, or null when no LLM arm runs or the call failed. */
  llm(messages: Msg[]): Promise<{ text: string } | null>;
}

export function modelArms(cacheDir: string, decisionModels: readonly string[], llmModel: string): ModelArms {
  return {
    async decideAll(state, questions, lane) {
      const out: Record<string, Record<string, number | null> | null> = {};
      for (const model of decisionModels) out[armName(model)] = (await decide(cacheDir, model, state, questions, lane))?.nouls ?? null;
      return out;
    },
    async llm(messages) {
      if (!llmModel) return null;
      return cachedCall(cacheDir, "llm", { model: llmModel, messages }, async () => ({
        text: (await openrouterJson({ model: llmModel, messages: messages as never, maxTokens: 400 })).text,
      }));
    },
  };
}

// The cache folder keeps its name for every decision model: the key carries the model.
function decide(cacheDir: string, model: string, state: unknown, questions: Record<string, JevQuestion>, lane: string) {
  return cachedCall(cacheDir, "jev", { model, state, questions }, async () => {
    const run = await askJev({ state, questions, model, lane, timeoutMs: 60_000 });
    return { nouls: Object.fromEntries(Object.keys(questions).map((id) => [id, noulOf(run, id)])), cost: run.cost };
  });
}

async function cachedCall<T>(cacheDir: string, arm: string, keyObj: unknown, fn: () => Promise<T>): Promise<T | null> {
  const file = path.join(cacheDir, arm, `${crypto.createHash("sha256").update(JSON.stringify(keyObj)).digest("hex")}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  try {
    const v = await fn();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(v));
    return v;
  } catch (err) {
    const msg = (err as Error).message;
    // A key, credit or permission refusal fails every call the same way: stop instead of scoring it as model errors.
    if (/\b(401|402|403)\b/.test(msg)) throw new Error(`${arm}: ${msg.slice(0, 200)}`);
    console.warn(`  ${arm} failed: ${msg.slice(0, 160)}`);
    return null;
  }
}
