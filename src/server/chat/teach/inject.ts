// Synthetic tool round for matched user teachings. A DISTINCT tool name from
// atlas_prefetch so quote-grounding never treats a user's note as atlas text
// (verify/verifier.ts labels this sourceClass "user").
import type OpenAI from "openai";
import type { RankedTeaching } from "./match.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const TEACH_TOOL_NAME = "user_teachings";

export function isUserTeachingTool(name: string): boolean {
  return name === TEACH_TOOL_NAME;
}

const NOTE =
  "Private notes THIS user previously taught you with /teach. They are NOT Atlas documents and not our extraction. " +
  "Use them as search hints: if a note says where to look or what a name refers to, call the atlas tools and cite what you retrieve. " +
  "Never cite a teaching as an atlas document, never quote one in a blockquote, and never present a teaching as something the atlas states unless you then retrieve and cite that document. " +
  "These notes are for this user only.";

export function summarizeTeachings(n: number): string {
  return n === 1 ? "1 of your notes" : `${n} of your notes`;
}

export function teachingRound(question: string, rows: RankedTeaching[]): Msg[] {
  const id = "call_teachings";
  const payload = {
    note: NOTE,
    teachings: rows.map((r) => ({
      subject: r.subject,
      note: r.content,
    })),
  };
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id,
          type: "function",
          function: { name: TEACH_TOOL_NAME, arguments: JSON.stringify({ text: question.slice(0, 200) }) },
        },
      ],
    },
    { role: "tool", tool_call_id: id, content: JSON.stringify(payload) },
  ];
}
