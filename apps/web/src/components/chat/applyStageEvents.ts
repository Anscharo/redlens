import type { ChatEventOf, MessageEventHandlers } from "./applyEvent";
import type { ChatMsg, StageLogEntry, VerifyState } from "./chatTypes";

// The verdict a turn shows while the audit is in flight: set when the
// `checking` stage first appears, replaced by `verify_result`.
const CHECKING_VERIFY: VerifyState = {
  status: "checking",
  contradictions: [],
  rulingIssued: false,
  invalidCitations: [],
  invalidDocNos: [],
  docNoMismatches: [],
  ungroundedQuotes: [],
  ungroundedAddresses: [],
  ungroundedCitationValues: [],
  paramMismatches: [],
  completenessFailures: [],
  missingExternalDisclaimer: false,
  mscCitedAsAtlas: [],
  lengthCapped: false,
};

// Coalesce consecutive same-stage rows into one; every non-null detail is
// APPENDED to that row's `details` (nothing shown is ever replaced), skipping
// only an exact repeat of the last line (e.g. a duplicate keep-alive). A
// different stage starts a new row. `at` is fixed at first append.
export function appendStage(log: StageLogEntry[], ev: ChatEventOf<"status">, round: number): StageLogEntry[] {
  const last = log[log.length - 1];
  if (!last || last.stage !== ev.stage) {
    return [...log, { stage: ev.stage, details: ev.detail ? [ev.detail] : [], at: log.length, round }];
  }
  const repeat = !ev.detail || ev.detail === last.details[last.details.length - 1];
  return [...log.slice(0, -1), { ...last, details: repeat ? last.details : [...last.details, ev.detail!] }];
}

const status: MessageEventHandlers["status"] = (m, ev): ChatMsg => ({
  ...m,
  statusLine: ev.detail ?? `${ev.stage}…`,
  stageLog: appendStage(m.stageLog ?? [], ev, m.rounds),
  ...(ev.stage === "checking" && !m.verify ? { verify: { ...CHECKING_VERIFY } } : {}),
});

// Fill the OLDEST open row for this tool name — results arrive in call
// order, so a forward scan pairs repeated-tool-name rounds correctly.
const toolResult: MessageEventHandlers["tool_result"] = (m, ev) => {
  const trace = m.trace.slice();
  const i = trace.findIndex((t) => t.name === ev.name && t.ok === null);
  if (i !== -1) trace[i] = { ...trace[i], ok: ev.ok, bytes: ev.bytes };
  return { ...m, trace };
};

// What the turn did on its way to an answer: stage rows, recalled facts,
// tool calls and their results, and files it handed over.
export const stageEventHandlers: MessageEventHandlers = {
  status,
  // Prepended: facts ran before the first tool call. Always round 0.
  facts: (m, ev) => ({
    ...m,
    trace: [
      ...ev.facts.map((fa) => ({ name: fa.id, args: {}, ok: true, bytes: null, kind: "fact" as const, summary: fa.summary, round: 0 })),
      ...m.trace,
    ],
  }),
  // rounds is bumped in the send loop BEFORE the first tool_call of a batch
  // dispatches, so m.rounds here is already the incremented value.
  tool_call: (m, ev) => ({ ...m, trace: [...m.trace, { name: ev.name, args: ev.args, ok: null, bytes: null, round: m.rounds }] }),
  tool_result: toolResult,
  // Download/track side effects stay in the hook — this only records the
  // artifact on the message.
  export: (m, ev) => ({
    ...m,
    exports: [...(m.exports ?? []), { format: ev.format, filename: ev.filename, mime: ev.mime, content: ev.content, bytes: ev.content.length }],
  }),
};
