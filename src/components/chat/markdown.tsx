import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { atlasHref } from "../../lib/routes";

// Agent citations are markdown links of the form [Title](/atlas/<uuid>)
// (system-prompt.ts forces UUID hrefs). We intercept those, SPA-navigate via
// onAtlas, and let any other href fall through to a normal new-tab link.
const ATLAS_HREF_RE = /^\/atlas\/([0-9a-f-]{36})$/i;

// Reference-style citations: a definition block (`[label]: /atlas/<uuid>`,
// normally at the top of the answer, but may appear anywhere) plus
// `[text][label]` usages elsewhere in the prose. Label matching is
// case-insensitive and whitespace-normalized, per CommonMark. Up to 3 leading
// spaces are tolerated (CommonMark allows that much indentation before a
// definition still counts). See docs/plans/reference-citations.md.
const DEFINITION_RE = /^[ \t]{0,3}\[([^\]\n]+)\]:\s*\/atlas\/([0-9a-f-]{36})\s*$/gim;

// One combined scan over the answer text, tried most-specific-first at each
// `[`:
//   1. inline atlas link       [text](/atlas/<uuid>)
//   2. reference-style usage   [text][label]  (or a comma-separated label
//      list — a malformed-but-unambiguous "cited from multiple docs", seen in
//      the 2026-07-28 model bakeoff)
//   3. bare bracket              [label]  — CommonMark's *shortcut* reference
//      link: remark resolves this as a real link when `label` has a
//      definition (rendering `<a href=…>label</a>`, exactly like case 2 with
//      text === label), so it's a citation too when defined. When it has no
//      definition it's emphasis gone wrong (also from the bakeoff, e.g.
//      "[20 percentage points]"), not a citation, so it's dropped.
// The *collapsed* reference form `[label][]` needs no separate handling: its
// empty second bracket fails case 2's non-empty requirement, so it falls
// through to case 3 and resolves identically (the trailing `[]` matches
// nothing and is harmlessly ignored).
// Bracket contents exclude newlines so an unrelated unclosed `[` earlier in
// the answer can't bridge across lines into what looks like a real citation.
const CITATION_SCAN_RE =
  /\[([^\]\n]+)\]\(\/atlas\/([0-9a-f-]{36})\)|\[([^\]\n]+)\]\[([^\]\n]+)\]|\[([^\]\n]+)\]/gi;

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface Source {
  uuid: string;
  /** Raw link text as written by the model. Under reference-style citations
   *  this is frequently a value, quoted phrase, date, or address rather than
   *  the doc's real title — Sources.tsx resolves the actual title from
   *  docs.json and only falls back to this string when the uuid isn't in the
   *  bundle. */
  title: string;
}

// Pull unique cited atlas docs out of the answer text, in order of
// appearance. Supports inline `[Title](/atlas/<uuid>)` links, full reference
// usages (`[text][label]`), and CommonMark *shortcut*/*collapsed* reference
// links (`[label]` / `[label][]`) resolved through a `[label]: /atlas/<uuid>`
// definition block — see docs/plans/reference-citations.md. This must track
// what AtlasMarkdown (react-markdown/remark) actually renders as a link:
// anything remark turns into an atlas `<a>` has to show up here too, or the
// doc is cited and clickable in the answer yet missing from the Sources
// cluster. A label used but never defined, or a definition never used, is
// silently skipped (neither is a citation). Two malformed shapes measured in
// a real model bakeoff are also tolerated: a comma-separated label list
// splits into one citation per resolvable label, and a bare bracket with no
// matching definition is dropped as non-citation prose rather than
// corrupting the list.
export function extractSources(content: string): Source[] {
  const definitions = new Map<string, string>(); // normalized label -> lowercased uuid
  for (const m of content.matchAll(DEFINITION_RE)) {
    const label = normalizeLabel(m[1]);
    if (!definitions.has(label)) definitions.set(label, m[2].toLowerCase());
  }

  // A definition line's own `[label]` is a declaration, not a use — but now
  // that a bare bracket can resolve as a shortcut reference, scanning it
  // unmodified would make every definition cite itself. Strip matched
  // definition lines before scanning for usages; this only deletes text, so
  // the relative order of the remaining usages is unaffected.
  const usageText = content.replace(DEFINITION_RE, "");

  const seen = new Set<string>();
  const out: Source[] = [];
  const add = (uuid: string, title: string) => {
    if (seen.has(uuid)) return;
    seen.add(uuid);
    out.push({ uuid, title });
  };

  for (const m of usageText.matchAll(CITATION_SCAN_RE)) {
    const [, inlineText, inlineUuid, refText, refLabels, bareText] = m;
    if (inlineUuid) {
      add(inlineUuid.toLowerCase(), inlineText);
      continue;
    }
    if (refLabels) {
      for (const rawLabel of refLabels.split(",")) {
        const uuid = definitions.get(normalizeLabel(rawLabel));
        if (uuid) add(uuid, refText);
      }
      continue;
    }
    // Bare bracket, e.g. [spark-rate] or [20 percentage points]. A shortcut
    // reference link when the label is defined (a real citation, rendered as
    // a link — see comment on CITATION_SCAN_RE); otherwise ordinary prose.
    const uuid = definitions.get(normalizeLabel(bareText));
    if (uuid) add(uuid, bareText);
  }
  return out;
}

// Mid-stream, a half-streamed ``` fence would swallow the rest of the panel as
// a code block. If the fence count is odd, append a synthetic closer for
// rendering only (the raw buffer is untouched; done.content is authoritative).
export function balanceFences(text: string): string {
  const fences = (text.match(/```/g) ?? []).length;
  return fences % 2 === 1 ? text + "\n```" : text;
}

export function AtlasMarkdown({ content, onAtlas }: { content: string; onAtlas: (uuid: string) => void }) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children, ...props }) {
        const m = href ? ATLAS_HREF_RE.exec(href) : null;
        if (m) {
          const uuid = m[1].toLowerCase();
          return (
            <a
              href={atlasHref(uuid)}
              onClick={(e) => {
                e.preventDefault();
                onAtlas(uuid);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
    }),
    [onAtlas],
  );

  return (
    <div className="rlc-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
