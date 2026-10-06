// The one scan that turns a chat answer into the atlas docs it cites. Pure and
// import-free so the browser (Sources chips) and the server (a conversation's
// auto collection, the list's citation count) count the same documents.
// Syntax: docs/plans/reference-citations.md.

// Reference-style definitions: a definition block (`[label]: /atlas/<uuid>`,
// normally at the top of the answer, but may appear anywhere). Label matching
// is case-insensitive and whitespace-normalized, per CommonMark. Up to 3
// leading spaces are tolerated (CommonMark allows that much indentation before
// a definition still counts).
export const DEFINITION_RE = /^[ \t]{0,3}\[([^\]\n]+)\]:\s*\/atlas\/([0-9a-f-]{36})\s*$/gim;

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** normalized label -> lowercased uuid, first definition wins. */
export function parseDefinitions(content: string): Map<string, string> {
  const definitions = new Map<string, string>();
  for (const m of content.matchAll(DEFINITION_RE)) {
    const label = normalizeLabel(m[1]);
    if (!definitions.has(label)) definitions.set(label, m[2].toLowerCase());
  }
  return definitions;
}

// One combined scan over the answer text, tried most-specific-first at each
// `[`:
//   1. inline atlas link       [text](/atlas/<uuid>)
//   2. reference-style usage   [text][label]  (or a comma-separated label
//      list — a malformed-but-unambiguous "cited from multiple docs")
//   3. bare bracket              [label]  — CommonMark's *shortcut* reference
//      link: remark resolves this as a real link when `label` has a
//      definition (rendering `<a href=…>label</a>`, exactly like case 2 with
//      text === label), so it's a citation too when defined. When it has no
//      definition it's emphasis gone wrong, e.g. "[20 percentage points]", not
//      a citation, so it's dropped.
// The *collapsed* reference form `[label][]` needs no separate handling: its
// empty second bracket fails case 2's non-empty requirement, so it falls
// through to case 3 and resolves identically (the trailing `[]` matches
// nothing and is harmlessly ignored).
// Bracket contents exclude newlines so an unrelated unclosed `[` earlier in
// the answer can't bridge across lines into what looks like a real citation.
const CITATION_SCAN_RE =
  /\[([^\]\n]+)\]\(\/atlas\/([0-9a-f-]{36})\)|\[([^\]\n]+)\]\[([^\]\n]+)\]|\[([^\]\n]+)\]/gi;

export interface CitedDoc {
  uuid: string;
  /** Raw link text as written by the model. Under reference-style citations
   *  this is frequently a value, quoted phrase, date, or address rather than
   *  the doc's real title — the Sources chips resolve the actual title from
   *  docs.json and only fall back to this string when the uuid isn't there. */
  title: string;
}

// Pull unique cited atlas docs out of the answer text, in order of
// appearance. This must track what the answer renderer (react-markdown/remark)
// actually turns into an atlas link: anything it renders as one has to show up
// here too, or the doc is cited and clickable in the answer yet missing from
// the Sources cluster. A label used but never defined, or a definition never
// used, is silently skipped (neither is a citation).
export function extractCitedDocs(content: string): CitedDoc[] {
  const definitions = parseDefinitions(content); // normalized label -> lowercased uuid

  // A definition line's own `[label]` is a declaration, not a use — but a bare
  // bracket can resolve as a shortcut reference, so scanning it unmodified
  // would make every definition cite itself. Strip matched definition lines
  // before scanning for usages; this only deletes text, so the relative order
  // of the remaining usages is unaffected.
  const usageText = content.replace(DEFINITION_RE, "");

  const seen = new Set<string>();
  const out: CitedDoc[] = [];
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
    const uuid = definitions.get(normalizeLabel(bareText));
    if (uuid) add(uuid, bareText);
  }
  return out;
}
