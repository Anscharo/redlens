import type { ComponentProps } from "react";
import { AtlasMarkdown, balanceFences } from "./markdown";
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
  revision: "A verification check found problems with this draft. The corrected answer is below.",
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
// live: a revision usually invalidates ONE claim, so the rest are still worth
// following.
//
// Strikethrough is reserved for a draft that was WRONG — rejected by the
// verifier. That is the "cross it out" case. A `tool_round` draft was never
// judged wrong, only unverified, so it is dimmed rather than struck; striking
// it would assert an error that never happened.
//
// Its note deliberately does NOT say when the text was written or what it was
// written from. The clear fires whenever a round produced text AND tool calls,
// which happens on round 1 (nothing retrieved yet) and equally on round 3
// (the model had atlas data, wrote from it, then decided to search again).
// "Written before searching the atlas" was the first wording and it was only
// true in the first case. What holds in every case: the model set it aside to
// keep searching, and cleared text never reaches the verifier — only
// done.content is audited.
//
// Each draft is marked up as <del> (transparent content model, so block
// content inside it is valid) rather than only visually styled, so a screen
// reader announces it as retracted rather than as the current reply.
// role="note" + aria-label is what makes the wrapper reachable — aria-label
// alone on a bare <div> is dropped from the accessibility tree.
export function SupersededAnswer({ drafts, onAtlas, ...props }: SupersededAnswerProps) {
  if (!drafts.length) return null;
  return (
    <>
      {drafts.map((draft, i) => (
        <div
          key={i}
          className="rlc-superseded"
          data-reason={draft.reason}
          role="note"
          aria-label="An earlier draft, replaced later in this answer"
          {...props}
        >
          <p className="rlc-superseded-note">{NOTE[draft.reason]}</p>
          <del className="rlc-superseded-text">
            <AtlasMarkdown content={balanceFences(draft.text)} onAtlas={onAtlas} />
          </del>
        </div>
      ))}
    </>
  );
}
