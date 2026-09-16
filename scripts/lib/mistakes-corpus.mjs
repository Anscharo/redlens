// Corpus-wide detectors for the Potential Mistakes sweep.
//
// The document sweep chunks the atlas and gives each chunk to one agent. That
// makes a whole class of defect structurally invisible to it: one that exists
// only in the COMPARISON between documents in different chunks -- "six prime
// artifacts say `circulating` where two say `total`". No chunk contains such a
// finding, so no agent can report it.
//
// These detectors close that gap. They are deterministic (no model, no network)
// and they OWN the rows they produce: a corpus row carrying a `detector` id is
// re-derived from scratch on every full run, which is what lets `--full` mean
// "re-derive everything" rather than "re-read every document and hope". A
// corpus row with no `detector` is hand-authored and is never touched.

/** Prime Agent artifacts are the one place the atlas instantiates the same
 *  template eight times, which is what makes divergence detectable at all. */
const ARTIFACT_ROOT = /^A\.6\.1\.1\.[0-9]+$/;
const ARTIFACT_MEMBER = /^(A\.6\.1\.1\.[0-9]+)\.(.+)$/;

/** Documents at the same position in different artifacts are the same slot. */
export function slotKey(docNo) {
  const m = docNo.match(ARTIFACT_MEMBER);
  return m ? { slot: `A.6.1.1.*.${m[2]}`, root: m[1] } : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Strip what legitimately differs between two artifacts, and NOTHING else.
 *
 * The agent's own name and token symbol go, because every artifact says its
 * own. Markdown emphasis, smart punctuation and a/an agreement go, because they
 * are noise.
 *
 * A reference does NOT go. It is rewritten to the SLOT it points at, so a link
 * into the equivalent position of each artifact's own subtree compares equal
 * while a link into a different position does not -- which is what lets this
 * see a wrong link target. Masking references to <doc>/<uuid>, as the first
 * version did, made every target look alike: a link pointing somewhere else
 * entirely was invisible unless its title text happened to differ too.
 *
 * `docNoOf` resolves a UUID to its doc_no. Without it a UUID cannot be placed
 * in the slot space and falls back to <uuid>, which is the old blind spot.
 */
export function normalizeForCompare(text, artifactName, docNoOf) {
  const toSlot = (docNo) => slotKey(docNo)?.slot ?? docNo;
  return (text ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    // Emphasis goes FIRST: a slot marker contains a `*`, so stripping after the
    // substitutions would eat it and print `A.6.1.1..2.2.3` in the finding.
    .replace(/[`*_]/g, "")
    .replaceAll(new RegExp(`\\b${escapeRe(artifactName || "\\u0000")}\\b`, "gi"), "<agent>")
    .replace(/\b[A-Z][A-Z0-9]{2,}\b/g, "<agent>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (u) => {
      const docNo = docNoOf?.(u.toLowerCase());
      return docNo ? toSlot(docNo) : "<uuid>";
    })
    .replace(/A\.[0-9]+(?:\.[0-9]+)+/g, toSlot)
    .replace(/\ban\b/gi, "a")
    .replace(/\s+/g, " ")
    // A space before a comma, or a trailing full stop the sentence splitter may
    // or may not have taken, is formatting. Left in, it reports two artifacts as
    // disagreeing about a rule when they differ by one keystroke of whitespace.
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[.,;:]+$/, "")
    .trim()
    .toLowerCase();
}

const splitSentences = (text) =>
  (text ?? "").split(/(?<=[.:])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** Words in `a` that `b` does not have. The readable half of a diff. */
export function uniqueWords(a, b) {
  const other = new Set(b.split(" "));
  return [...new Set(a.split(" ").filter((w) => w && !other.has(w)))];
}

/** Word-level edit distance via LCS -- how far apart two sentences really are. */
export function wordDistance(a, b) {
  const A = a.split(" ");
  const B = b.split(" ");
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return A.length + B.length - 2 * dp[A.length][B.length];
}

const MIN_SENTENCE_WORDS = 12;
const MIN_ARTIFACTS = 4;
const MAX_DIVERGENT_WORDS = 6;

/**
 * Template divergence: one sentence, instantiated at the same slot in several
 * Prime Agent artifacts, that does not say the same thing in all of them.
 *
 * Reports only a SMALL divergence (<= MAX_DIVERGENT_WORDS) inside a sentence of
 * real length, present in at least MIN_ARTIFACTS artifacts. A large difference
 * means the artifacts genuinely say different things there, which is not a
 * defect; a one-word difference in a sentence eight artifacts otherwise share is
 * the template drifting.
 */
export function templateDivergence(nodes) {
  const names = new Map(
    nodes.filter((n) => ARTIFACT_ROOT.test(n.doc_no)).map((n) => [n.doc_no, n.title]),
  );
  const byUuid = new Map(nodes.map((n) => [n.id.toLowerCase(), n.doc_no]));
  const docNoOf = (uuid) => byUuid.get(uuid);
  const bySlot = new Map();
  for (const n of nodes) {
    const k = slotKey(n.doc_no);
    if (!k) continue;
    if (!bySlot.has(k.slot)) bySlot.set(k.slot, []);
    bySlot.get(k.slot).push({ node: n, root: k.root, name: names.get(k.root) ?? "" });
  }

  const findings = [];
  for (const [slot, members] of bySlot) {
    if (new Set(members.map((m) => m.root)).size < MIN_ARTIFACTS) continue;
    if (new Set(members.map((m) => m.node.title.toLowerCase())).size > 1) continue;

    // Every sentence in the slot, grouped by its exact normalized text. No
    // positional key: bucketing on the opening and closing words (as the first
    // version did) hid any divergence that fell in them, which is exactly where
    // a trailing link target sits.
    const variantsByText = new Map();
    for (const m of members) {
      for (const raw of splitSentences(m.node.content)) {
        const text = normalizeForCompare(raw, m.name, docNoOf);
        if (text.split(" ").length < MIN_SENTENCE_WORDS) continue;
        if (!variantsByText.has(text)) variantsByText.set(text, []);
        variantsByText.get(text).push({ ...m, raw });
      }
    }

    // Group the variants into FAMILIES first: two readings belong to the same
    // template sentence when they are within one small edit of each other. Only
    // then is each family's majority compared against its other members.
    //
    // Both halves matter. Comparing every pair turns a three-way split into
    // three rows saying everyone differs from everyone. Comparing against the
    // SLOT's majority instead misses the real case entirely: a document holds
    // several sentences, so the divergent pair are usually both minorities
    // within their slot -- that is what made this stop seeing the Root Edit
    // circulating/total defect it was written for.
    const variants = [...variantsByText.entries()];
    const family = variants.map((_, i) => i);
    const find = (i) => (family[i] === i ? i : (family[i] = find(family[i])));
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const d = wordDistance(variants[i][0], variants[j][0]);
        if (d > 0 && d <= MAX_DIVERGENT_WORDS) family[find(i)] = find(j);
      }
    }
    const families = new Map();
    variants.forEach((v, i) => {
      const root = find(i);
      if (!families.has(root)) families.set(root, []);
      families.get(root).push(v);
    });

    for (const members of families.values()) {
      if (members.length < 2) continue;
      const [major, ...minorities] = [...members].sort((a, b) => b[1].length - a[1].length);
      for (const minor of minorities) {
        const majorRoots = new Set(major[1].map((m) => m.root));
        const minorRoots = new Set(minor[1].map((m) => m.root));
        // Two READINGS of one sentence are held by different artifacts. When the
        // same artifact appears on both sides these are two different sentences
        // that happen to be similar, and the finding reads absurdly: "Spark says
        // X, while Spark says Y".
        if ([...minorRoots].some((r) => majorRoots.has(r))) continue;
        if (new Set([...majorRoots, ...minorRoots]).size < MIN_ARTIFACTS) continue;
        const changed = wordDistance(major[0], minor[0]);
        if (changed === 0 || changed > MAX_DIVERGENT_WORDS) continue;
      const majorOnly = uniqueWords(major[0], minor[0]);
      const minorOnly = uniqueWords(minor[0], major[0]);
      if (!majorOnly.length && !minorOnly.length) continue; // reordering only

      const say = (rows, words) =>
        `${rows.map((r) => r.name).join(", ")} say "${words.join(" ")}"`;
      // A slot can have more than one divergent sentence, so the differing word
      // goes in the id: without it the rows collide and the report shows one.
      const tag = (minorOnly[0] ?? majorOnly[0] ?? "").replace(/[^a-z0-9]+/gi, "").slice(0, 12);
      findings.push({
        id: `${slot}#structural${tag ? `-${tag}` : ""}`,
        docNo: slot,
        uuid: null,
        file: "A.6.1.1.* (all prime artifacts)",
        category: "structural",
        severity: /[0-9]/.test([...majorOnly, ...minorOnly].join("")) ? "high" : "medium",
        pass: "deterministic",
        detector: "template-divergence",
        quote: minor[1][0].raw,
        issue:
          `The same sentence at ${slot} does not say the same thing in every Prime Agent artifact: ` +
          `${say(major[1], majorOnly)}, while ${say(minor[1], minorOnly)}. ` +
          "Only visible corpus-wide; no single chunk of the sweep contains both.",
          fix: "",
        });
      }
    }
  }
  return findings.sort((a, b) => a.docNo.localeCompare(b.docNo));
}

/** Every corpus detector, by the id its rows carry. */
export const CORPUS_DETECTORS = { "template-divergence": templateDivergence };

/** Run them all. Findings carry `detector`, which is what makes them
 *  re-derivable and therefore safe for `--full` to retire and rebuild. */
export function runCorpusDetectors(nodes) {
  return Object.values(CORPUS_DETECTORS).flatMap((d) => d(nodes));
}
