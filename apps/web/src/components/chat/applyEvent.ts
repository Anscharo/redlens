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

// In-flight model states that must not outlive the verdict:
//   - "pending"   — refute submitted, no `paragraph_refute` yet. In
//                   `answer` mode (or against an older build) none ever
//                   arrives; a hollow pending mark after the verdict
//                   misreads as "still running" rather than "it never ran".
//   - "candidate" — refute found ≥1 candidate, still under the confirm
//                   gate. Confirm resolves at `verify_result`; leaving the
//                   mark would say "possible contradiction, being confirmed"
//                   next to a finished badge (green or red). Agreed
//                   contradictions live on the chip; unagreed ones must
//                   not keep speaking.
// `model` is REMOVED, not set to "failed"/"ok": nothing failed, the
// in-flight step simply ended. `ok` and `failed` are already terminal and
// stay. `ParagraphChecks` renders no mark at all when `model` is undefined.
function clearInFlightModelMarks<T extends ParagraphCheck[] | undefined>(list: T): T {
  if (!list || !list.some((c) => c.model === "pending" || c.model === "candidate")) return list;
  return list.map((c) => {
    if (c.model !== "pending" && c.model !== "candidate") return c;
    const { model: _inFlight, ...rest } = c;
    return rest;
  }) as T;
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
        // verify_result precedes done (see api.ts's event-ordering comment),
        // so this is normally where in-flight marks (pending / candidate)
        // get cleared — done repeats the same clear defensively in case it
        // ever lands first instead.
        paragraphChecks: clearInFlightModelMarks(m.paragraphChecks),
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

    case "paragraph_check": {
      // A set-aside draft's checks move onto SupersededDraft.checks on
      // `clear`, above — this only ever accumulates the CURRENT live draft's
      // checks. The model call is submitted right after this event, so this
      // row becomes "pending" — UNLESS a `paragraph_refute` for this index
      // already resolved first (odd timing), in which case its state stands.
      const list = m.paragraphChecks ?? [];
      const existing = list.find((c) => c.index === ev.index);
      return {
        ...m,
        paragraphChecks: upsertParagraphCheck(list, {
          index: ev.index,
          text: ev.text,
          findings: ev.findings,
          model: existing?.model ?? "pending",
        }),
      };
    }

    case "paragraph_refute": {
      // May arrive before its matching `paragraph_check` — create the row
      // with empty text/findings if so; `paragraph_check` fills those in
      // later without disturbing the model state already set here.
      const list = m.paragraphChecks ?? [];
      const existing = list.find((c) => c.index === ev.index);
      const model: ParagraphCheck["model"] = !ev.parsed ? "failed" : ev.candidates > 0 ? "candidate" : "ok";
      return {
        ...m,
        paragraphChecks: upsertParagraphCheck(list, {
          index: ev.index,
          text: existing?.text ?? "",
          findings: existing?.findings ?? [],
          model,
        }),
      };
    }

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
        // The turn is over — clear any mark still in-flight (verify_result
        // usually already did; see the comment there and on
        // clearInFlightModelMarks). Superseded drafts keep their own checks
        // frozen from when they were set aside, so they need the same
        // clear here.
        paragraphChecks: clearInFlightModelMarks(m.paragraphChecks),
        superseded: m.superseded?.map((d) => ({ ...d, checks: clearInFlightModelMarks(d.checks) })),
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
