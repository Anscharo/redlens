// Off-spec reference-definition shapes, rewritten to the canonical
// `[label]: /atlas/<uuid>` line every definition parser reads
// (citation-normalize.ts DEF_RE, citation-repair.ts DEF_LINE_RE,
// definition-block-gate.ts DEF). Canonicalizing once, before any of them runs,
// keeps those three regexes on the one shape the prompt asks for.
//
// Both shapes are restricted to /atlas/<uuid> destinations: a prose line that
// merely ends in a colon and a path elsewhere must stay prose.

const ATLAS_DEST = String.raw`<?\/atlas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}>?`;

// `[Title][label]: /atlas/<uuid>` — the use syntax with a colon appended. The
// label is what the prose cites, so it becomes the definition's label. The title
// is dropped: span-match.ts reads definition lines with no title after the path.
const TITLED_RE = new RegExp(String.raw`^( {0,3})\[([^[\]\n]{1,120})\]\[([^[\]\n]{1,120})\]:[ \t]*(${ATLAS_DEST})[ \t]*$`);

// `Name: /atlas/<uuid>` — a definition with no brackets at all. A list item
// (`- Name: /atlas/…`) is prose that happens to hold a path, so it is excluded.
const BARE_RE = new RegExp(String.raw`^( {0,3})(?![-*+] |\d+[.)] |>)([^[\]\n:]{1,120}?):[ \t]*(${ATLAS_DEST})[ \t]*$`);

// The canonical form of an off-spec definition line, or null when the line is
// not one (a canonical line also returns null: there is nothing to rewrite).
export function canonicalDefLine(line: string): string | null {
  const t = TITLED_RE.exec(line);
  if (t) return `${t[1]}[${t[3].trim()}]: ${t[4]}`;
  const b = BARE_RE.exec(line);
  return b ? `${b[1]}[${b[2].trim()}]: ${b[3]}` : null;
}

// Could a partial first line, still without its newline, become a titled
// definition? `[Title][` and `[Title][label` keep the streaming gate buffering.
// The bare shape is never predicted mid-line: it starts like any prose line,
// and holding every answer's first line for it would stall the stream.
export function couldBeTitledDef(s: string): boolean {
  const m = /^ {0,3}\[[^[\]\n]{1,120}\]\[[^[\]\n]{0,120}(\]?)([^\n]?)/.exec(s);
  if (!m) return false;
  if (m[1] === "") return true;
  return m[2] === "" || m[2] === ":";
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A used label with no exact definition, matched to a definition by slug: the
// model defines `[Casting And Execution Of Approved Spell]` and cites
// `[…][casting-and-execution]`. An equal slug wins. Otherwise the use's slug
// must be a word-boundary prefix of exactly one definition's slug. Ambiguity
// returns null, so the caller's undefined-label path decides.
export function matchLabelBySlug(key: string, labels: Iterable<string>): string | null {
  const k = slug(key);
  if (!k) return null;
  const all = [...labels];
  const exact = all.filter((l) => slug(l) === k);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const prefix = all.filter((l) => slug(l).startsWith(`${k}-`));
  return prefix.length === 1 ? prefix[0] : null;
}
