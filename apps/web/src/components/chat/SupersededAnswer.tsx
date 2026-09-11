import type { ComponentProps } from "react";
import { AtlasMarkdown, balanceFences } from "./markdown";
import { ParagraphChecks } from "./ParagraphChecks";
import type { SupersededDraft } from "./useChatStream";

export type SupersededAnswerProps = ComponentProps<"div"> & {
  /** Drafts this turn showed the reader and moved on from, in arrival order. */
  drafts: SupersededDraft[];
  onAtlas: (uuid: string) => void;
};

// Why each block stopped being the answer. Every one ends by pointing DOWN:
// the replacement always renders below, so the reader is never left wondering
// where the text went (beta feedback: "if a rewrite is requested that should
// be placed below").
const NOTE: Record<SupersededDraft["reason"], string> = {
  tool_round: "The assistant set this aside to keep searching. It was never checked — the answer is below.",
};

// Beta feedback, verbatim: "i requested for text shown to user to never be
// deleted just restyled as its jarring to remove it and sometimes they
// actually want it." So a `clear` never deletes: useChatStream moves the live
// buffer into ChatMsg.superseded and this renders it ABOVE the replacement.
//
// Rendered through AtlasMarkdown, NOT as plain text. The point of keeping a
// draft is that someone reads it, and they already saw this text with its
// markdown rendered — handing back raw source ("**7 signers**", a bare
// /atlas/<uuid> href) is the same loss in a different form. Citations stay
// live.
//
// Its note deliberately does NOT say when the text was written or what it was
// written from. The clear fires whenever a round produced text AND tool calls,
// which happens on round 1 (nothing retrieved yet) and equally on round 3
// (the model had atlas data, wrote from it, then decided to search again).
// "Written before searching the atlas" was the first wording and it was only
// true in the first case. What holds in every case: the model set it aside to
// keep searching, and cleared text never reaches the verifier — only the
// final answer is audited.
//
// Rendered by StageSlot.tsx inside the "synthesizing" stage row's slot
// (shown once that row is clicked open), scoped to that round's own drafts
// (`d.round === entry.round`) — a turn with more than one tool round shows
// each superseded draft under the round that produced it, not all bunched at
// the top of the turn the way the pre-checklist layout did.
export function SupersededAnswer({ drafts, onAtlas, className, ...props }: SupersededAnswerProps) {
  if (!drafts.length) return null;
  return (
    <div className={["rlc-superseded-list", className].filter(Boolean).join(" ")} {...props}>
      {drafts.map((draft, i) => (
        <div
          key={i}
          className="rlc-superseded"
          data-reason={draft.reason}
          role="note"
          aria-label="An earlier draft, replaced later in this answer"
        >
          <p className="rlc-superseded-note">{NOTE[draft.reason]}</p>
          <div className="rlc-superseded-text">
            <AtlasMarkdown content={balanceFences(draft.text)} onAtlas={onAtlas} />
          </div>
          {draft.checks?.length ? <ParagraphChecks checks={draft.checks} /> : null}
        </div>
      ))}
    </div>
  );
}
