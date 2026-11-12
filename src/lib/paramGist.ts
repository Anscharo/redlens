// The value a param's sentence states, so a card can show it as the value and
// keep the sentence for hover ("Maximum Allocation: The maximum allocation for
// this Instance is 20,000,000 USD." shows "20,000,000 USD"). Read from the
// value's first sentence only, and only in one of three forms:
//   - a key about an address or its holder (an Address, Admin, Owner or Role
//     key) whose sentence names exactly one backticked address: that address;
//   - "Z is the/a <key> …" (the key names what Z is): Z, "The Spark Foundation";
//   - "The <key> … is Z" (the key names the subject): Z, when the value says
//     nothing more.
// The gist stands in for the text, so it is given only where nothing it drops
// changes the meaning: a Z followed by a clause ("is 7%, applied to …") or by
// another sentence ("… is 0.01%. It is 0.5% for withdrawals."), and an address
// the sentence denies or puts in the past, are no gist. Nor is a
// Z that reads as a verb ("is defined in …", "is calculated …"), restates the
// subject, is longer than a value, or is the whole text. Pure.

const MAX_GIST = 48;
const ADDRESS_RE = /`\s*(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\s*`/g;
const VERB_RE = /^(?:\w+ly\s+)?[a-z]+ed\b/;
const KEY_NOISE = /\b(?:address|addresses)\b/gi;
const ADDRESS_KEY_RE = /\b(?:address|addresses|admin|owner|role|account)\b/i;
/** Words that make a named address something other than the key's current one. */
const NOT_CURRENT_RE = /\b(?:not|no longer|never|previously|formerly|former|was|were)\b/i;
/** Where one sentence ends and the next begins: a full stop, then a capital; never after an initial ("U.S. Treasury"). */
const SENTENCE_END_RE = /(?<=[.!?])(?<!\b[A-Z]\.)\s+(?=[A-Z])/;

/** Letters and digits only, lowercased: how a key and a sentence are compared. */
const flat = (s: string) => s.toLowerCase().replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[^a-z0-9]/g, "");

/** The value's sentences on its first line. */
const sentences = (v: string) => v.trim().split("\n")[0].split(SENTENCE_END_RE);
/** Whether the value says more than its first sentence. */
const saysMore = (v: string) => sentences(v).length > 1 || v.trim().includes("\n");
const firstSentence = (v: string) => sentences(v)[0].replace(/(?<!\b[A-Z])\.\s*$/, "").trim();

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Z is the/a [word] <key> …": the key names what Z is. */
function namedAs(sentence: string, key: string): string | null {
  const m = /^(.+?)\s+is\s+(?:the|a|an)\s+(.+)$/i.exec(sentence);
  if (!m) return null;
  const what = m[2].split(/\s+/);
  return flat(what.join(" ")).startsWith(key) || flat(what.slice(1).join(" ")).startsWith(key) ? m[1] : null;
}

/** "The <key> … is Z": the key names the subject. */
function subjectIs(sentence: string, key: string): string | null {
  const m = /^(?:The\s+)?(.+?)\s+(?:is|are)\s+(.+)$/i.exec(sentence);
  if (!m) return null;
  const subject = flat(m[1]);
  if (!(subject.includes(key) || (subject.length >= 6 && key.includes(subject)))) return null;
  if (/[,;]\s/.test(m[2])) return null;
  const z = m[2].replace(/(?<!\b[A-Z])\.+$/, "").trim();
  return VERB_RE.test(z) || flat(z).includes(subject) ? null : z;
}

/** The value a param's text states, or null when it is not one sentence of a known form. */
export function paramGist(key: string, value: string): string | null {
  const sentence = firstSentence(value);
  const addresses = [...sentence.matchAll(ADDRESS_RE)].map((m) => m[1]);
  if (addresses.length === 1 && ADDRESS_KEY_RE.test(key)) return NOT_CURRENT_RE.test(sentence) ? null : addresses[0];
  if (addresses.length) return null;
  const k = flat(key.replace(KEY_NOISE, ""));
  if (k.length < 3) return null;
  const z = namedAs(sentence, k) ?? (saysMore(value) ? null : subjectIs(sentence, k));
  return z && z.length <= MAX_GIST && z !== value.trim() ? capitalise(z) : null;
}
