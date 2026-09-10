import type { ChatEvent } from "./api";
import type { ChatMsg, ParagraphCheck } from "./chatTypes";
import { appendReasoning, splitToolRoundText } from "./splitToolRound";

// Upsert by `index`: a re-emitted index replaces that entry in place,
// otherwise the new check is inserted in index order (checks normally arrive
// in order, but this keeps rendering correct even if one is ever re-sent
// out of order).
function upsertParagraphCheck(list: ParagraphCheck[], check: ParagraphCheck): ParagraphCheck[] {
  const i = list.findIndex((c) => c.index === check.index);
  if (i !== -1) {
    const next = list.slice();
    next[i] = check;
    return next;
  }
  const insertAt = list.findIndex((c) => c.index > check.index);
  if (insertAt === -1) return [...list, check];
  return [...list.slice(0, insertAt), check, ...list.slice(insertAt)];
}

// Pure per-message event application, split out of useChatStream's old
// `dispatch` switch. Handles every event EXCEPT `meta`/`error` — those touch
// hook-level state (conversationId, the error banner), not the message
// itself — and `export`'s download/track side effects, which the hook still
// runs before calling this (see useChatStream.ts `dispatch`).
export function applyEvent(m: ChatMsg, ev: ChatEvent): ChatMsg {
  switch (ev.type) {
    case "token":
      // Live buffer only — `content` stays empty until answer_final/done.
      return { ...m, draft: m.draft + ev.text, statusLine: null };

    case "reasoning":
      // Own field — never joins draft/content (answer prose, verified).
      return { ...m, reasoning: (m.reasoning ?? "") + ev.text };

    case "status": {
      // Coalesce consecutive same-stage rows into one; every non-null detail
      // is APPENDED to that row's `details` (nothing shown is ever replaced
      // — CLAUDE.md/task rule), skipping only an exact repeat of the last
      // line (e.g. a duplicate keep-alive). A different stage starts a new
      // row. `at` is fixed at first append.
      const log = m.stageLog ?? [];
      const last = log[log.length - 1];
      const stageLog =
        last && last.stage === ev.stage
          ? [
              ...log.slice(0, -1),
              {
                ...last,
                details:
                  ev.detail && ev.detail !== last.details[last.details.length - 1]
                    ? [...last.details, ev.detail]
                    : last.details,
              },
            ]
          : [...log, { stage: ev.stage, details: ev.detail ? [ev.detail] : [], at: log.length, round: m.rounds }];
      return {
        ...m,
        statusLine: ev.detail ?? `${ev.stage}…`,
        stageLog,
        ...(ev.stage === "checking" && !m.verify
          ? {
              verify: {
                status: "checking" as const,
                contradictions: [],
                notFound: [],
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
              },
            }
          : {}),
      };
    }

    case "verify_result":
      return {
        ...m,
        verify: {
          status: ev.overall,
          contradictions: ev.contradictions,
          notFound: ev.notFound ?? [],
          rulingIssued: ev.rulingIssued ?? false,
          invalidCitations: ev.invalidCitations,
          invalidDocNos: ev.invalidDocNos,
          docNoMismatches: ev.docNoMismatches,
          ungroundedQuotes: ev.ungroundedQuotes,
          ungroundedAddresses: ev.ungroundedAddresses,
          ungroundedCitationValues: ev.ungroundedCitationValues ?? [],
          paramMismatches: ev.paramMismatches ?? [],
          completenessFailures: ev.completenessFailures ?? [],
          missingExternalDisclaimer: ev.missingExternalDisclaimer ?? false,
          mscCitedAsAtlas: ev.mscCitedAsAtlas ?? [],
          lengthCapped: ev.lengthCapped ?? false,
        },
      };

    case "clear": {
      const kept = m.superseded ?? [];
      // `degenerate` is the ONE clear that really deletes — a repetition
      // loop, machine noise no one wants back.
      if (ev.reason === "degenerate") return { ...m, draft: "", paragraphChecks: [] };
      // Every other clear (`tool_round` / absent reason) keeps what
      // streamed — restyled, pushed above the replacement, never deleted.
      // Whitespace-only buffers are dropped: nothing to read.
      if (!m.draft.trim()) return { ...m, draft: "", paragraphChecks: [] };
      // Mixed preamble + leaked tool-call markup: markup is thinking, not a
      // draft; the rest stays a prechecked answer.
      const { thinking, draft } = splitToolRoundText(m.draft);
      return {
        ...m,
        draft: "",
        paragraphChecks: [],
        reasoning: appendReasoning(m.reasoning, thinking),
        superseded: draft
          ? [...kept, { text: draft, reason: "tool_round" as const, round: m.rounds, checks: m.paragraphChecks }]
          : kept,
      };
    }

    case "paragraph_check":
      // A set-aside draft's checks move onto SupersededDraft.checks on
      // `clear`, above — this only ever accumulates the CURRENT live draft's
      // checks.
      return {
        ...m,
        paragraphChecks: upsertParagraphCheck(m.paragraphChecks ?? [], {
          index: ev.index,
          text: ev.text,
          findings: ev.findings,
        }),
      };

    case "export":
      // Download/track side effects stay in the hook — this only records the
      // artifact on the message.
      return {
        ...m,
        exports: [
          ...(m.exports ?? []),
          { format: ev.format, filename: ev.filename, mime: ev.mime, content: ev.content, bytes: ev.content.length },
        ],
      };

    case "facts":
      // Prepended: facts ran before the first tool call. Always round 0.
      return {
        ...m,
        trace: [
          ...ev.facts.map((fa) => ({
            name: fa.id,
            args: {},
            ok: true,
            bytes: null,
            kind: "fact" as const,
            summary: fa.summary,
            round: 0,
          })),
          ...m.trace,
        ],
      };

    case "tool_call":
      // rounds is bumped in the send loop BEFORE the first tool_call of a
      // batch dispatches, so m.rounds here is already the incremented value.
      return {
        ...m,
        trace: [...m.trace, { name: ev.name, args: ev.args, ok: null, bytes: null, round: m.rounds }],
      };

    case "tool_result": {
      const trace = m.trace.slice();
      // Fill the OLDEST open row for this tool name — results arrive in call
      // order, so a forward scan pairs repeated-tool-name rounds correctly.
      for (let i = 0; i < trace.length; i++) {
        if (trace[i].name === ev.name && trace[i].ok === null) {
          trace[i] = { ...trace[i], ok: ev.ok, bytes: ev.bytes };
          break;
        }
      }
      return { ...m, trace };
    }

    case "answer_final":
      return { ...m, content: ev.content, generated: true, draft: "" };

    case "done":
      return {
        ...m,
        content: ev.content, // authoritative final answer
        generated: true,
        draft: "",
        sources: ev.toolCalls,
        done: true,
        statusLine: null,
        // A "checking" chip that never resolved (verifier off/failed
        // silently) must not spin forever.
        ...(m.verify?.status === "checking" ? { verify: undefined } : {}),
      };

    // `meta`/`error` are handled by the hook (they touch hook-level state,
    // not the message) — pass the message through unchanged.
    default:
      return m;
  }
}
