import type { SlashCompletion } from "@/lib/chatSlashCommands";

// Autocomplete overlay for a slash command in the composer. A textarea can't
// colour part of its own text, so this mirrors the draft in a div laid over the
// textarea (same font and padding — one shared CSS rule) and paints the typed
// part in the accent and the completion translucently. While it is shown the
// textarea's own text is transparent (chat.css, `[data-state="completing"]`)
// so only the overlay's colouring is visible. It only ever exists while the
// draft is a single `/word` token, so there is no wrapping or scroll to sync.
export function SlashGhost({ completion }: { completion: SlashCompletion }) {
  return (
    <div className="rlc-slash-ghost" aria-hidden="true">
      {completion.lead}
      <span className="rlc-slash-typed">{completion.typed}</span>
      <span className="rlc-slash-rest">{completion.rest}</span>
    </div>
  );
}
