// Duty-text helpers shared by the role-responsibility reports (GovOps,
// Facilitator). Pure string shaping — row derivation stays in each report's
// own module.

import { stripMarkdownLinks } from "./atlasHelpers";

// Content snippet for a duty row with no matched quote (title-discovered
// duties). `preferRe` names the report's role so the snippet opens with the
// unit that actually mentions the actor.
export function dutySnippet(content: string, preferRe: RegExp): string {
  const cleaned = stripMarkdownLinks(content).replace(/[*_`#]/g, "").trim();
  // Units are single lines (bullets stay whole), further split at sentence
  // boundaries — a sentence-only split let unpunctuated bullet lists glue into
  // one giant "sentence" that opened with the wrong actor's text.
  const units = cleaned
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((s) => s.replace(/^[-\s]+/, "").trim())
    .filter(Boolean);
  if (!units.length) return cleaned.slice(0, 160);
  // Prefer the unit naming the role — but not a bare Responsible Party
  // declaration (that fact already lives in the row's actor column).
  let i = units.findIndex(
    (s) => preferRe.test(s) && !/^The Responsible Party/i.test(s),
  );
  if (i === -1) i = 0;
  const last = units.length - 1;
  return (i > 0 ? "…" : "") + units[i] + (i < last ? "…" : "");
}

// First meaningful line of a doc — used as the "duty" description for
// process-step rows, whose content is a bulleted update spec rather than
// prose sentences.
export function firstLine(content: string): string {
  const line = stripMarkdownLinks(content)
    .replace(/[*_`#]/g, "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  return (line ?? "").slice(0, 160);
}
