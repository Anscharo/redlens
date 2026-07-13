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

// One doc merged into a collapsed duty row (see dutyCollapseKeyer below).
// Shared by the GovOps and Facilitator report row shapes.
export interface MergedSource {
  docNo: string;
  uuid: string;
  agent?: string; // Prime Agent whose artifact subtree holds this copy
}

// Collapse-key factory for per-agent-artifact duty rows. Same-title docs
// replicated once per agent artifact may only collapse when the doc CONTENT is
// also the same — otherwise unrelated duties sharing a structural title
// ("Modification" of two different multisigs) get silently merged, dropping
// rows and misattributing agents. Key on the full content, NOT the edge's
// matched quote: quotes are truncated at a fixed length by build-graph, so
// their tails differ by however long the agent's name is. Two per-agent
// replicas of the same duty differ only by the agent's own name ("reviews
// Spark's calculation" vs "reviews Grove's calculation"), the link UUIDs into
// their own subtrees, and trivial punctuation ("two-thirds" vs "two thirds",
// curly vs straight apostrophes) — so the key strips markdown links, masks the
// given agent names (longest first, so multi-word names win), and collapses
// every non-alphanumeric run before comparing.
export function dutyCollapseKeyer(agentNames: readonly string[]): (content: string) => string {
  const names = agentNames.filter(Boolean).sort((a, b) => b.length - a.length);
  const maskRe = names.length
    ? new RegExp(`\\b(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
    : null;
  return (content: string) => {
    const stripped = stripMarkdownLinks(content);
    return (maskRe ? stripped.replace(maskRe, " ") : stripped)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  };
}

// Process-step "Update" docs open with a boilerplate sentence ("The Document
// is updated as follows.") before the actual field/RP/trigger spec — a
// useless preview on its own. When firstLine() would return this, pull the
// Responsible Party and Trigger bullets instead, which are the two facts a
// reader actually wants (who, and when).
const BOILERPLATE_HEADER_RE = /^the document(?:\s+in the agent artifact)? is updated as follows:?\.?$/i;
const RP_LINE_RE = /^\s*-\s*responsible part(?:y|ies):\s*(.+)$/im;
const TRIGGER_LINE_RE = /^\s*-\s*trigger(?:s|\s*-\s*\w+)?:\s*(.+)$/im;

function fieldSummary(content: string): string | null {
  const rp = RP_LINE_RE.exec(content)?.[1]?.trim();
  const trigger = TRIGGER_LINE_RE.exec(content)?.[1]?.trim();
  if (!rp && !trigger) return null;
  const clean = (s: string) => stripMarkdownLinks(s).replace(/[*_`#]/g, "").replace(/\.$/, "").trim();
  const parts: string[] = [];
  if (rp) parts.push(`Responsible Party: ${clean(rp)}`);
  if (trigger) parts.push(`Trigger: ${clean(trigger)}`);
  return parts.join(" · ").slice(0, 160);
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
  if (line && BOILERPLATE_HEADER_RE.test(line)) {
    const summary = fieldSummary(content);
    if (summary) return summary;
  }
  return (line ?? "").slice(0, 160);
}
