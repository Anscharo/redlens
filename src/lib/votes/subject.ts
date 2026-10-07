// The subject check: does an executive mention the named things a claim says
// it carried? An executive on the right date is not evidence on its own — one
// can carry four transfers and omit the fifth that the atlas credits to it.
// Pure.

const MONTHS_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/g;
const DOC_NO_RE = /\b[A-Z]\.[\w.]*\d\b/g;
const NAME_RE = /\b[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/g;
// Capitalised words that open sentences or name the vote itself, never a subject.
const NOISE = new Set([
  "the", "this", "that", "these", "those", "any", "all", "each", "in", "as", "at", "on", "for", "of", "and",
  "to", "by", "from", "with", "after", "before", "following", "beginning", "notwithstanding", "until",
  "if", "when", "see", "stage", "executive", "vote", "votes", "out-of-schedule",
]);

/** The capitalised terms of a clause, lowercased and deduplicated: the names a vote would have to mention. */
export function subjectTerms(clause: string): string[] {
  const words = clause.replace(MONTHS_RE, " ").replace(DOC_NO_RE, " ").match(NAME_RE) ?? [];
  const terms = words.map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !NOISE.has(w));
  return [...new Set(terms)];
}

// A term in at most this share of executives is rare enough to identify an action.
const RARE_SHARE = 0.25;
// Without a rare term, terms in at most this share still say something; above it they are boilerplate.
const COMMON_SHARE = 0.75;

/** Term lookups over a fixed set of lowercased executive texts, with document frequencies memoised. */
export class SubjectCorpus {
  private readonly df = new Map<string, number>();
  private readonly patterns = new Map<string, RegExp>();
  private readonly texts: readonly string[];

  constructor(texts: readonly string[]) {
    this.texts = texts;
  }

  has(text: string, term: string): boolean {
    let re = this.patterns.get(term);
    if (!re) this.patterns.set(term, (re = new RegExp(`\\b${term}`)));
    return re.test(text);
  }

  share(term: string): number {
    let n = this.df.get(term);
    if (n === undefined) this.df.set(term, (n = this.texts.filter((t) => this.has(t, term)).length));
    return this.texts.length ? n / this.texts.length : 0;
  }
}

export interface SubjectCheck {
  verdict: "found" | "missing" | "unchecked";
  found: string[];
  missing: string[];
}

/**
 * Checks `terms` against one executive's text. Only discriminating terms
 * count: the rare ones when the claim has any, else the merely uncommon ones,
 * since a word every executive uses ("USDS", "Spell") is no evidence. The
 * subject is found when the rarest of them is present and at least half of
 * them are; a claim with no discriminating term is unchecked.
 */
export function checkSubject(terms: readonly string[], text: string, corpus: SubjectCorpus): SubjectCheck {
  const rare = terms.filter((t) => corpus.share(t) <= RARE_SHARE);
  const considered = rare.length ? rare : terms.filter((t) => corpus.share(t) <= COMMON_SHARE);
  if (!considered.length) return { verdict: "unchecked", found: [], missing: [] };
  const found = considered.filter((t) => corpus.has(text, t));
  const missing = considered.filter((t) => !found.includes(t));
  const rarest = Math.min(...considered.map((t) => corpus.share(t)));
  const rarestPresent = considered.every((t) => corpus.share(t) > rarest || found.includes(t));
  const verdict = rarestPresent && found.length * 2 >= considered.length ? "found" : "missing";
  return { verdict, found, missing };
}
