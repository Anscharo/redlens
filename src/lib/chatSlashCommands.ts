// Chat slash commands + one pure completion function. Zero imports, so the
// composer, its tests, and any future server-side reader agree on the list.
//
// This is the CHAT registry — apps/web/src/lib/shortcuts.ts holds the search
// bar's `/reports` / `/radar` / `/h` commands, a different surface with a
// different contract (those navigate; these are sent as the message).
//
// The server recognises a command only at the START of the message (leading
// whitespace allowed — see src/server/chat/teach/parse.ts), so completion
// follows the same rule: it only ever fires while the draft is a single
// `/word` token and nothing else.

export interface ChatSlashCommand {
  cmd: string; // canonical spelling, including the leading slash
  description: string;
}

export const CHAT_SLASH_COMMANDS: ChatSlashCommand[] = [
  { cmd: "/teach", description: "Save a private note the chat remembers on later turns" },
];

export interface SlashCompletion {
  /** Whitespace before the slash, preserved verbatim on accept. */
  lead: string;
  /** What the user has typed so far, e.g. `/t` (their casing). */
  typed: string;
  /** The ghost — the remainder of the command, e.g. `each`. */
  rest: string;
  /** The command being completed. */
  command: ChatSlashCommand;
}

const TOKEN_RE = /^(\s*)(\/\S*)$/;

/** The completion the composer should offer for `draft`, or null when there is
 *  nothing to complete: the draft is not a lone `/word` token, it already spells
 *  a full command, or no command starts with it. Case-insensitive; on a bare `/`
 *  the first registered command wins. */
export function completeSlashCommand(
  draft: string,
  commands: ChatSlashCommand[] = CHAT_SLASH_COMMANDS,
): SlashCompletion | null {
  const m = TOKEN_RE.exec(draft);
  if (!m) return null;
  const [, lead, typed] = m as unknown as [string, string, string];
  const lower = typed.toLowerCase();
  const command = commands.find((c) => c.cmd.toLowerCase().startsWith(lower));
  if (!command || command.cmd.length === typed.length) return null;
  return { lead, typed, rest: command.cmd.slice(typed.length), command };
}

/** The draft after accepting `c`: the command in its canonical spelling plus
 *  a trailing space, so the user can keep typing the command's argument. */
export function acceptSlashCompletion(c: SlashCompletion): string {
  return `${c.lead}${c.command.cmd} `;
}
