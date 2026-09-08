import { ArrowDownIcon } from "./glyphs";

/**
 * "There is new text below" — shown only while the reader has scrolled away
 * from the bottom of the thread.
 *
 * Must be an ABSOLUTE child of .rlc-thread-wrap (see chat.css): in the flex
 * flow it would shorten the thread the moment it appeared, moving the very
 * text the detached reader is holding still. The wrap is the non-scrolling
 * box that exactly spans the thread — the same anchor the context line uses.
 */
export function NewMessagesPill({
  onClick,
  streaming,
}: {
  onClick: () => void;
  streaming: boolean;
}) {
  return (
    <button
      type="button"
      className="rlc-jump"
      onClick={onClick}
      data-streaming={streaming || undefined}
    >
      <ArrowDownIcon />
      {streaming ? "Still writing below" : "New messages below"}
    </button>
  );
}
