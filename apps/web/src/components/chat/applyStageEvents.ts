import type { ChatEventOf, MessageEventHandlers } from "./applyEvent";
import type { ChatMsg, StageLogEntry, VerifyState } from "./chatTypes";

// Shown from the `checking` stage until `verify_result`.
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

// Coalesces same-stage rows, appending each detail except an exact repeat of the last.
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

// Oldest open row first: results arrive in call order.
const toolResult: MessageEventHandlers["tool_result"] = (m, ev) => {
  const trace = m.trace.slice();
  const i = trace.findIndex((t) => t.name === ev.name && t.ok === null);
  if (i !== -1) trace[i] = { ...trace[i], ok: ev.ok, bytes: ev.bytes };
  return { ...m, trace };
};

export const stageEventHandlers: MessageEventHandlers = {
  status,
  // Prepended: facts run before the first tool call.
  facts: (m, ev) => ({
    ...m,
    trace: [
      ...ev.facts.map((fa) => ({ name: fa.id, args: {}, ok: true, bytes: null, kind: "fact" as const, summary: fa.summary, round: 0 })),
      ...m.trace,
    ],
  }),
  // The send loop bumps rounds before a batch's first tool_call.
  tool_call: (m, ev) => ({ ...m, trace: [...m.trace, { name: ev.name, args: ev.args, ok: null, bytes: null, round: m.rounds }] }),
  tool_result: toolResult,
  // Download side effects live in the hook.
  export: (m, ev) => ({
    ...m,
    exports: [...(m.exports ?? []), { format: ev.format, filename: ev.filename, mime: ev.mime, content: ev.content, bytes: ev.content.length }],
  }),
};
