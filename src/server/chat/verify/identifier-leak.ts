// Internal-identifier leak repair. Tool results carry machine handles the user
// never sees in the reader — an entity `slug`, a raw `id` — and models paste
// them into prose as a pseudo-citation when they have a row but not a fact:
// `**Grove Freezer Multisig**: (Slug: grove-freezer-multisig)`. It reads like a
// link, resolves to nothing, and is exactly the "placeholder citation" the
// system prompt forbids, so the prompt alone has not stopped it.
//
// One pure pass, run after citation repair: a leaked handle that resolves to a
// document RETRIEVED THIS TURN turns into a real citation — linking the name
// the prose already used, which is what the model should have written — and
// anything else is deleted along with the separator that introduced it. The
// evidence gate is deliberate: synthesizing a link to a doc the model never
// retrieved would assert grounding it never established, the same line
// createLinkJudge draws.
import { normalizeForMatch } from "./verify-checks.ts";
import type { Indexes, AtlasNode } from "../../retrieval/indexes.ts";

export interface IdentifierRepair {
  content: string;
  // "grove-freezer-multisig → A.6.1.1.2.2.6.1.2.1.2.2.4" — leaks promoted.
  linkified: string[];
  // Handles that resolved to nothing retrieved this turn, and were deleted.
  removed: string[];
}

// Keys that name a machine handle. An explicit vocabulary is load-bearing: the
// same answers write `(Ethereum)`, `(Prime Agent)`, `(Ecosystem Actor)`, which
// are legitimate prose and must survive untouched. `[:=]` and a whitespace-free
// value keep this to the identifier shape — a user asking "what is Grove's
// slug?" can still be answered with `slug: grove` in ordinary prose.
const KEYS = "slugs?|uuids?|ids?|doc[_ ]?id|entity[_ ]?id|node[_ ]?id|entity[_ ]?type";
const LEAK_RE = new RegExp(String.raw`\(\s*(?:${KEYS})\s*[:=]\s*([^()\s]{1,80})\s*\)`, "gi");

// The prose immediately before a leak: an optionally emphasized name, then the
// separator that introduced the handle (`**Grove Freezer Multisig**: `). The
// name may not contain markdown link syntax — an already-linked name is left
// alone rather than nested.
const NAME_TAIL = /(\*{0,2}|__?)([^*_`[\]()\n]{2,80}?)\1[ \t]*[:—–-]?[ \t]*$/;
const SEP_TAIL = /[ \t]*[:—–-]?[ \t]*$/;

const FENCE_RE = /^ {0,3}(?:```|~~~)/;
const unwrap = (v: string): string => v.replace(/^[`"'“”]+|[`"'“”,.;]+$/g, "");
// Odd backtick count before the match → the parenthetical sits inside an inline
// code span, where an identifier is being discussed, not cited.
const inCode = (before: string): boolean => (before.match(/`/g)?.length ?? 0) % 2 === 1;

interface Resolved {
  doc: AtlasNode;
  // The entity's qualified name ("Grove Freezer Multisig") — better link text
  // than the doc's own title, which the atlas leaves unqualified because the
  // hierarchy supplies the agent ("Freezer Multisig" belongs to six agents).
  name: string;
}

// What a leaked handle stands for: an entity slug via its defining doc, or a
// doc uuid written as one. Null when nothing resolves, or when the document
// never appeared in this turn's tool results.
function resolveHandle(value: string, ix: Indexes, evidence: string): Resolved | null {
  const key = value.toLowerCase();
  const entity = ix.entityBySlug.get(key);
  const docId = entity?.defining_doc_id ?? (ix.docMap.has(key) ? key : null);
  if (!docId || !evidence.includes(docId.toLowerCase())) return null;
  const doc = ix.docMap.get(docId);
  return doc ? { doc, name: entity?.name ?? doc.title } : null;
}

// Link the name the prose already wrote, dropping the separator with it:
// `**Grove Freezer Multisig**: ` → `**[Grove Freezer Multisig](/atlas/…)**`.
// Null when the preceding text isn't that name, so the caller falls back to a
// standalone citation instead of mislabeling someone else's words as the link.
function linkPrecedingName(before: string, r: Resolved): string | null {
  const m = before.match(NAME_TAIL);
  if (!m || normalizeForMatch(m[2]) !== normalizeForMatch(r.name)) return null;
  return `${before.slice(0, m.index)}${m[1]}[${m[2]}](/atlas/${r.doc.id})${m[1]}`;
}

// Delete side: absorb the separator the handle hung off, but only behind real
// content — a line-leading `- ` is a bullet marker, not a separator.
function dropSeparator(before: string): string {
  const cut = before.replace(SEP_TAIL, "");
  return /\S/.test(cut) ? cut : before.replace(/[ \t]+$/, "");
}

function fixLine(line: string, ix: Indexes, evidence: string, rep: IdentifierRepair): string {
  LEAK_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  for (let m = LEAK_RE.exec(line); m; m = LEAK_RE.exec(line)) {
    if (inCode(line.slice(0, m.index))) continue;
    const before = line.slice(last, m.index);
    last = m.index + m[0].length;
    const handle = unwrap(m[1]);
    const r = resolveHandle(handle, ix, evidence);
    if (!r) {
      rep.removed.push(handle);
      out += dropSeparator(before);
      continue;
    }
    rep.linkified.push(`${handle} → ${r.doc.doc_no}`);
    out += linkPrecedingName(before, r) ?? `${before}([${r.name}](/atlas/${r.doc.id}))`;
  }
  return last === 0 ? line : (out + line.slice(last)).replace(/[ \t]+$/, "");
}

export function repairIdentifierLeaks(answer: string, evidenceTexts: string[], ix: Indexes): IdentifierRepair {
  const rep: IdentifierRepair = { content: answer, linkified: [], removed: [] };
  if (!answer.includes("(")) return rep;
  const evidence = evidenceTexts.join("\n").toLowerCase();

  let fence = false;
  const lines = answer.split("\n").map((line) => {
    if (FENCE_RE.test(line)) {
      fence = !fence;
      return line;
    }
    // Fenced code is verbatim; a blockquote is verbatim atlas text (the system
    // prompt reserves it for quotation), and rewriting inside one would turn a
    // faithful quote into an ungrounded one.
    if (fence || /^\s*>/.test(line) || !line.includes("(")) return line;
    return fixLine(line, ix, evidence, rep);
  });

  return { content: lines.join("\n"), linkified: [...new Set(rep.linkified)], removed: [...new Set(rep.removed)] };
}
