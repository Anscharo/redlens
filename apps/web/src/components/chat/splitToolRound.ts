// Tool-round clears mix two very different kinds of streamed text: a preamble
// the reader might still want, and leaked tool-call markup the model emitted
// as content before the structured call (chat-loop.test.ts's `ool_call>` is
// the measured shape). Markup is scratch work — it belongs with thinking, not
// with a kept draft. Prose stays a prechecked answer.
//
// Line-based on purpose: a sentence that *mentions* atlas_query is still a
// draft; a line that *is* a tag or a tool-call JSON payload is not.

const TOOL_TAG =
  /<\/?(?:[\w.:|-]*)tool[_-]?call\b|<\|tool|(?:^|\s)tool_call\s*>/i;
const TRUNCATED_TAG = /ool_call\s*>/i;
const XML_INVOKE = /<\/?(?:invoke|parameter|function)\b/i;
const TOOL_FENCE = /^```(?:tool_call|tool)\b/i;
const JSON_PAYLOAD = /^\s*\{[\s\S]*"name"\s*:\s*"[^"]+"[\s\S]*"arguments"\s*:/;
const JSON_NAME_LINE =
  /^\s*"name"\s*:\s*"(atlas_[a-z0-9_]+|ask_external_msc|export_findings|external_msc)"/i;
const JSON_ARGS_LINE = /^\s*"arguments"\s*:/;

export function looksLikeToolCallLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    TOOL_TAG.test(t) ||
    TRUNCATED_TAG.test(t) ||
    XML_INVOKE.test(t) ||
    TOOL_FENCE.test(t) ||
    JSON_PAYLOAD.test(t) ||
    JSON_NAME_LINE.test(t) ||
    JSON_ARGS_LINE.test(t)
  );
}

export function splitToolRoundText(text: string): { thinking: string; draft: string } {
  const thinking: string[] = [];
  const draft: string[] = [];
  for (const line of text.split("\n")) {
    if (looksLikeToolCallLine(line)) thinking.push(line);
    else draft.push(line);
  }
  return { thinking: thinking.join("\n").trim(), draft: draft.join("\n").trim() };
}

export function appendReasoning(existing: string | undefined, extra: string): string | undefined {
  const add = extra.trim();
  if (!add) return existing;
  const had = (existing ?? "").replace(/\s+$/, "");
  return had ? `${had}\n${add}` : add;
}
