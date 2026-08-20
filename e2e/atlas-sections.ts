// Consolidated-layout section parsing for the preview canary.
//
// Comparison semantics MUST match the preview server's diffSnapshots
// (src/server/preview/snapshot.ts): a doc is changed when its body, title, or
// doc_no differs — heading formatting and the [Type] tag are NOT compared
// (the parser doesn't hash them), so a type-only or heading-whitespace edit
// must not become an expected redline the preview will never mark.

const HEADING_UUID_RE = /^#{1,6} .*<!-- UUID: ([0-9a-fA-F-]{36}) -->\s*$/;
// Field shape mirrors scripts/lib/atlas-parser.mjs HEADING_RE (doc_no, trimmed
// title); the [Type] capture is deliberately discarded.
const HEADING_FIELDS_RE = /^#{1,6} ([\w.-]+) - (.+?) \[[^\]]+\]\s+<!--/;

export interface DocSection {
  doc_no: string;
  title: string;
  body: string;
}

/** Split a composed content file into per-doc sections keyed by lowercased
 *  uuid. The heading line is parsed into fields, not kept in the body. */
export function splitByUuid(text: string): Map<string, DocSection> {
  const sections = new Map<string, DocSection>();
  let current: DocSection | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current) current.body = buf.join("\n");
  };
  for (const line of text.split("\n")) {
    const m = line.match(HEADING_UUID_RE);
    if (m) {
      flush();
      const f = line.match(HEADING_FIELDS_RE);
      // A heading the field regex can't parse still compares stably: the raw
      // heading line stands in as the title, so any edit to it is a change.
      current = f ? { doc_no: f[1], title: f[2].trim(), body: "" } : { doc_no: "", title: line, body: "" };
      buf = [];
      sections.set(m[1].toLowerCase(), current);
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** Docs present in head that are new, or whose body/title/doc_no differs.
 *  Diffed over the UNION of all changed files per side, so a doc moved between
 *  two files in the same PR (identical fields, both files changed) is not a
 *  false change. Deleted docs are absent from head and never expected. */
export function changedDocIds(base: Map<string, DocSection>, head: Map<string, DocSection>): string[] {
  const ids: string[] = [];
  for (const [id, h] of head) {
    const b = base.get(id);
    if (!b || b.body !== h.body || b.title !== h.title || b.doc_no !== h.doc_no) ids.push(id);
  }
  return ids;
}
