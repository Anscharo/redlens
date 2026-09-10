// Tolerant JSON parsing for the harness's judge calls — shared by refute.ts
// and confirm.ts. Output caps cut JSON mid-structure routinely; the judgements
// already emitted are perfectly good, so discarding the whole response over a
// truncated tail loses real work.

// Close whatever a truncated generation left open: an unterminated string,
// then every unclosed array/object, innermost first. Strings are tracked
// properly (escapes included) so a brace inside a quoted span is never
// mistaken for structure.
export function closeTruncatedJson(src: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of src) {
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = src;
  if (inString) out += '"';
  out = out.replace(/,\s*$/, ""); // dangling comma before the synthetic closers
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out;
}

// Parse LLM JSON that is nearly right. Ordered cheapest-first: as written,
// then trailing commas removed, then structurally closed. Returns null only
// when nothing survives — matching citation-repair.ts's "repair, don't reject".
export function parseJsonish(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const s = stripped.indexOf("{");
  if (s === -1) return null;
  const e = stripped.lastIndexOf("}");
  const candidates = [
    e > s ? stripped.slice(s, e + 1) : "",
    e > s ? stripped.slice(s, e + 1).replace(/,(\s*[}\]])/g, "$1") : "",
    closeTruncatedJson(stripped.slice(s)),
    closeTruncatedJson(stripped.slice(s)).replace(/,(\s*[}\]])/g, "$1"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const j = JSON.parse(c) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {
      // try the next repair
    }
  }
  return null;
}
