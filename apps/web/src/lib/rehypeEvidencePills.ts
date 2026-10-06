// Rehype plugin: turns the curated crossview docs' literal evidence-level tags
// — `[evidence level 1 · censused]`, `[evidence level 2 · source-read ✓
// 2026-07-27]`, etc. (see docs/crossview/concepts.md's legend paragraph) — into
// small colored pills. Runs post-parse over the hast tree (mirrors
// rehypeEthAddresses.ts's text-splitting + code-span-unwrapping approach) so
// it catches the tag wherever it lands: mid-paragraph text, an italic label
// line, or backtick-wrapped inside a heading/bold run.
//
// One illustrative exception: the legend's own "never a combined [evidence
// level 3 · corroborated / evidence level 4 · unverified]-style range" example
// nests a second tag inside the first match's label — that's deliberately
// malformed prose, not a real tag, so it's left as plain text/code.

import type { Root, Element } from "hast";
import { replaceCodeSpans, replaceTextMatches } from "./rehypeReplace";

const EVIDENCE_RE = /\[evidence level ([1-4]) · ([^\]]+)\]/g;
const FULL_EVIDENCE_RE = /^\[evidence level ([1-4]) · ([^\]]+)\]$/;

function isNestedTag(label: string): boolean {
  return label.includes("evidence level");
}

function pillElement(level: string, label: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className: ["evidence-pill", `evidence-pill-${level}`] },
    children: [{ type: "text", value: `L${level} · ${label}` }],
  };
}

export function rehypeEvidencePills() {
  return () => (tree: Root) => {
    // Pass 1: a code span (backtick-wrapped tag) whose ENTIRE trimmed text is
    // one evidence tag gets unwrapped into a pill, dropping the code styling.
    replaceCodeSpans(tree, (text) => {
      const m = FULL_EVIDENCE_RE.exec(text);
      return m && !isNestedTag(m[2]) ? pillElement(m[1], m[2]) : null;
    });

    // Pass 2: plain-text occurrences (paragraph body, italic label lines,
    // bold unit-opener trailers). Skip text still inside an untouched code
    // span — a partial match there isn't a real tag (see the nested-tag guard,
    // which also leaves the malformed combined example as plain text).
    replaceTextMatches(
      tree,
      EVIDENCE_RE,
      (m) => (isNestedTag(m[2]) ? null : pillElement(m[1], m[2])),
      (parent) => "tagName" in parent && parent.tagName === "code",
    );
  };
}
