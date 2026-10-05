import { MD_LINK_SRC } from "./citation-links.ts";

const MD_LINKS = new RegExp(MD_LINK_SRC, "g");

// Whitespace/case/punctuation-tolerant containment form. Quote marks and
// markdown emphasis are authoring noise, not evidence differences: a model
// that writes `the 'Reward Instance' refers to…` around a term the atlas
// writes bare is quoting faithfully, and dropping quote characters on BOTH
// sides also collapses `"span"` and `span` to one key so a single quotation
// can't be counted twice.
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    // Tool results arrive as JSON, so a source line break is the literal two
    // characters \n — nothing quoting it verbatim could ever match.
    .replace(/\\[nrt]/g, " ")
    // Then drop EVERY remaining backslash, not "one escape level". Evidence is
    // JSON-encoded (`\\frac`) while the answer quotes the raw text (`\frac`);
    // unescaping one level leaves `\frac` on one side and `frac` on the other,
    // so a verbatim quote of a LaTeX formula would never match. Symmetric
    // stripping is what a match needs; the formatting pass below already
    // treats markup as noise, and LaTeX commands are markup.
    .replace(/\\/g, "")
    // Evidence carries raw markdown; an answer quotes the RENDERED text. Both
    // sides collapse to link text so `see [A.2.2.9.1 - Foo](uuid)` matches a
    // faithful quote of `see A.2.2.9.1 - Foo`.
    .replace(MD_LINKS, "$1")
    .replace(/[“”"‘’']/g, "")
    // `$` is a math delimiter (`$$…$$` in the atlas, `$…$` in an answer) —
    // formatting, same as emphasis and code marks.
    .replace(/[*_`$]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
