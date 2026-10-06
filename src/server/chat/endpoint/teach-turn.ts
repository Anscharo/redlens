// The /teach branch: review + persist the note, no atlas harness.
import { makeOpenrouterJson } from "../llm.ts";
import { sanitizeDone, type HarnessDone } from "../chat-orchestrator.ts";
import { runTeachCommand } from "../teach/handle.ts";
import { persistAssistant, titleIfDue } from "./persist.ts";
import { usedAfter, type ChatTurn } from "./turn.ts";
import type { Send } from "./stream.ts";

function teachDone(result: Awaited<ReturnType<typeof runTeachCommand>>): HarnessDone {
  return {
    type: "done",
    content: result.content,
    usage: result.usage,
    contextTokens: null,
    generationId: result.generationId,
    toolCalls: [],
    lengthCapped: false,
    transcript: [],
    checksMeta: [],
  };
}

export async function runTeachTurn(t: ChatTurn, teachCmd: NonNullable<ChatTurn["teachCmd"]>, send: Send): Promise<void> {
  send({ type: "status", stage: "synthesizing", detail: teachCmd.text ? "Reviewing your note…" : "How to teach me…" });
  const result = await runTeachCommand({
    userId: t.userId, convId: t.convId, text: teachCmd.text,
    jsonCall: makeOpenrouterJson(t.obs, "atlas-chat-teach-review"), signal: t.req.signal, obs: t.obs,
  });
  const done = teachDone(result);
  send({ type: "answer_final", content: done.content });
  send({ ...sanitizeDone(done), contextUsed: usedAfter(t, done.content, [], done.checksMeta) });
  if (t.req.signal.aborted) return;
  await persistAssistant(t.userId, t.convId, done, Date.now() - t.startedAt, t.obs);
  titleIfDue(t, done.content);
}
