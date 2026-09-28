// Extraction half of the A1 citation-support check (cite-support.ts judges).
// Turns an answer into (claim, cited doc) pairs that are actually worth a
// judgment. The first bakeoff found three causes of false flags; two were
// here, not in the model — it was being handed things that are not claims.
// (The third, pointer citations, is a question-design fix: the
// `about_document` option in cite-support.ts.)
//
//   1. TABLE ROWS were judged as raw `| a | b | c |` strings with the header
//      thrown away, so "Sky Core | 5M USDS | Planned" reached the judge with no
//      way to know which cell was a sender and which an amount. Tables are now
//      rewritten row by row into labelled prose before segmentation
//      ("Sender: Sky Core; Amount(s): 5M USDS; …"), which is what the row
//      MEANS, and link-only cells are moved behind the period so the existing
//      trailing-citation fold attaches them to the row's claim.
//   2. DEGENERATE SEGMENTS — a bold bullet label like `* **Spark**:` whose
//      only other content was a link — were judged as claims. A pair now needs
//      at least three real words once links and markup are gone.
//
// Segmentation itself is `claimSegments` (verify-checks.ts), which decides the
// sentence a trailing or dash-attributed citation belongs to.
import { CITATION_SRC, claimSegments, extractCitations, MD_LINK_SRC } from "./verify-checks.ts";

export interface CitationPair {
  /** The claim, with its link markup stripped (link TEXT is usually the doc's own title, which would beg the question). */
  claim: string;
  /** The doc that claim links to. */
  uuid: string;
  /**
   * The full sentence `claim` was taken from, present ONLY when the two
   * differ — i.e. when the sentence carried more than one citation and this
   * pair got just the clause its own link is attached to. The judge needs it
   * to resolve the subject and any pronouns ("and the setup of Executor
   * Accords" has no verb of its own), but must not judge the rest of it.
   */
  context?: string;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const ONLY_LINKS = new RegExp(`^(?:\\s*${MD_LINK_SRC}\\s*[,;]?)+\\s*$`);

const cellsOf = (row: string) =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));

/** Rewrites every markdown table into one labelled-prose line per data row. */
export function tablesAsProse(answer: string): string {
  const lines = answer.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!(TABLE_ROW.test(lines[i]) && TABLE_SEP.test(lines[i + 1] ?? ""))) {
      out.push(lines[i]);
      continue;
    }
    const header = cellsOf(lines[i]);
    i += 1; // the separator
    while (i + 1 < lines.length && TABLE_ROW.test(lines[i + 1])) {
      i += 1;
      const cells = cellsOf(lines[i]);
      const text: string[] = [];
      const links: string[] = [];
      cells.forEach((cell, k) => {
        if (!cell) return;
        if (ONLY_LINKS.test(cell)) links.push(cell);
        else text.push(`${header[k] || `Column ${k + 1}`}: ${cell}`);
      });
      if (text.length) out.push(`${text.join("; ")}.${links.length ? ` ${links.join(" ")}` : ""}`);
    }
  }
  return out.join("\n");
}

/**
 * Is this link being used as a NOUN in the sentence rather than as a source
 * marker? A link sitting right after a determiner or an opening paren is part
 * of the prose, and dropping it leaves a sentence with a hole in it:
 * "the [Rate Limits](…) was updated" became "the was updated", which is not a
 * claim at all. Observed 2026-09-28.
 *
 * That hole matters most for exactly the sentences the `about_document`
 * verdict exists to catch — "the X was updated on …", "the X document changed
 * N times" — because the words it destroys are the ones that mark the sentence
 * as being ABOUT the document rather than drawn from it.
 *
 * Anywhere else the link is an aside and dropping it leaves valid prose:
 * "…for new agents [A](…) and the setup of…" reads correctly without it, and
 * keeping the title there would hand the judge the cited document's own name
 * inside the claim it is meant to check. A parenthesis wrapping only the link
 * — "CRRs ([CRRs](…)) change often" — is a source marker too, and the empty
 * parens it leaves behind are swept up by cleanClaim below.
 */
const NOUN_LINK_LEAD = /\b(?:the|a|an|this|that|these|those)\s+$/i;
export const isNounLink = (before: string) => NOUN_LINK_LEAD.test(before.slice(-24));

/** Link-stripped, markup-stripped, with the debris stripped links leave behind. */
function cleanClaim(seg: string): string {
  return seg
    .replace(new RegExp(MD_LINK_SRC, "g"), (_m: string, text: string, offset: number, whole: string) =>
      isNounLink(whole.slice(0, offset)) ? text : " ",
    )
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "") // list marker
    .replace(/\*\*|__|`/g, "")
    .replace(/\(\s*[,;\s]*\)/g, "") // "( )" and "( , )" left by removed links
    .replace(/\(\s+/g, "(") // "( CRRs )" left by a kept noun link
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Three words of at least two letters. `* **Spark**:` has one. Exported
// because refute-screen.ts applies the SAME floor to the statements it
// screens, and the two are compared against each other in the eval — a
// second copy is a silent way for them to stop meaning the same thing.
export const MIN_CLAIM_WORDS = 3;
export const realWords = (s: string) => (s.match(/[A-Za-z]{2,}/g) ?? []).length;

// Whether a claim was sourced from a document's CONTENT or only from a record
// about it is not decided here any more. It used to be, by a list of regexes
// matching "(PR #336)", "was updated", "the history records" and so on — a
// semantic judgment written as pattern matching, which kept missing new
// phrasings ("Updates to implementation stages and a correction to reference
// implementations" has no verb and no date at all) and was replaced on
// 2026-09-28 by verify/provenance.ts. That reads what the turn actually
// retrieved, so a change-log answer is recognised by where its facts came
// from rather than by how its sentences are worded.

/**
 * Does this claim end where its own citations began?
 *
 * "This affected documents such as [A](…), [B](…)." asserts nothing on its
 * own — the substance WAS the list, and stripping the links leaves "This
 * affected documents such as". The judge then reads a sentence fragment
 * against a document and quite correctly says the document does not state it,
 * which reaches the reader as "Not stated in this source" about a citation
 * that was never a claim. Observed 2026-09-28; "The Distribution Reward
 * Payments are:" is the same shape and was a false flag in the 2026-09-24
 * bakeoff too.
 *
 * The signal is a dangling CONNECTOR or copula at the end, optionally followed
 * by a colon — NOT a colon on its own. A colon regularly ends a claim that has
 * its own substance and merely introduces examples: "all multisigs must adhere
 * to two baseline standards unless explicitly exempted:" is a real claim and a
 * bare-colon rule threw it away. Checked after trailing punctuation is stripped,
 * so "are:." reads as "are:".
 *
 * This sits beside MIN_CLAIM_WORDS: both ask whether there is a claim here at
 * all, and neither needs a model to answer it.
 */
const DANGLING_TAIL =
  /\b(?:such as|including|includes|like|for example|namely|as follows|e\.g|i\.e|see|and|or|with|is|are|was|were)\b\s*:?\s*$/i;

export const isLeadIn = (claim: string) => DANGLING_TAIL.test(claim.replace(/[.\s]+$/, ""));

/**
 * The clause each citation in a segment is attached to: the text since the
 * previous citation (or the start of the segment). Aligned index-for-index
 * with `extractCitations(seg)`.
 *
 * A sentence that cites twice — "they validate agent creation [A] and the
 * setup of Executor Accords [B]" — used to hand BOTH documents the WHOLE
 * sentence, so each was asked to justify an assertion it was never cited for
 * and `says_nothing` was the correct answer to the wrong question. Observed
 * 2026-09-24; at baseline it accounted for most of the check's false flags,
 * and it penalised exactly the careful citing style the citation dictate asks
 * for (cite each clause where it sits) over dumping every link at the end.
 *
 * `null` where the clause is too thin to stand on its own — a link at the very
 * start of a sentence ("As set out in [A], the threshold is seven"), or two
 * links side by side with no words between them. Those fall back to the whole
 * segment, which is exactly the old behaviour, so this can only ever narrow a
 * claim that HAS its own clause and never truncates one that doesn't.
 */
function attributedClauses(seg: string): (string | null)[] {
  const re = new RegExp(CITATION_SRC, "gi");
  const spans: { start: number; end: number }[] = [];
  for (let m = re.exec(seg); m; m = re.exec(seg)) spans.push({ start: m.index, end: m.index + m[0].length });

  const out: (string | null)[] = [];
  spans.forEach((sp, i) => {
    // The text since the previous citation — PLUS, for the last citation, the
    // tail after it. A trailing "." or a closing paren belongs to the clause
    // it ends, and a lone citation must therefore reproduce the whole segment
    // exactly: pieces are joined with a single space because that is what
    // cleanClaim's own link-stripping does, so a single-citation pair's claim
    // stays byte-identical to what it has always been.
    const before = seg.slice(i === 0 ? 0 : spans[i - 1].end, sp.start);
    // This citation's own link text, when it is prose rather than a marker.
    // cleanClaim applies the SAME rule to the whole segment, and the two must
    // agree or a single-citation claim stops equalling `whole` — which would
    // attach a spurious `context` to every pair and change every request.
    const own = isNounLink(before) ? seg.slice(sp.start, sp.end).replace(new RegExp(MD_LINK_SRC), "$1") : " ";
    const pieces = [before, own];
    if (i === spans.length - 1) pieces.push(seg.slice(sp.end));
    const clause = cleanClaim(pieces.join(" "));
    // Adjacent links share the clause before them, so inherit the last real
    // one rather than falling all the way back to the whole sentence.
    out.push(realWords(clause) >= MIN_CLAIM_WORDS ? clause : (out[out.length - 1] ?? null));
  });
  return out;
}

/**
 * Every (claim, cited doc) pair in an answer that is worth judging. De-duplicated
 * on (doc, claim), so a sentence repeated verbatim is one judgment, not two.
 *
 * A single-citation sentence is unchanged: its clause IS the whole sentence,
 * so no `context` is attached and the judge sees exactly what it always did.
 */
export function citationPairs(answer: string): CitationPair[] {
  const out: CitationPair[] = [];
  const seen = new Set<string>();
  for (const seg of claimSegments(tablesAsProse(answer))) {
    const cites = extractCitations(seg);
    if (!cites.length) continue;
    const whole = cleanClaim(seg);
    if (realWords(whole) < MIN_CLAIM_WORDS) continue;
    const clauses = attributedClauses(seg);
    cites.forEach((c, i) => {
      const claim = clauses[i] ?? whole;
      // The links WERE the claim — see isLeadIn. Nothing here to check.
      if (isLeadIn(claim)) return;
      const key = `${c.uuid}|${claim}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(claim === whole ? { claim, uuid: c.uuid } : { claim, uuid: c.uuid, context: whole });
    });
  }
  return out;
}
