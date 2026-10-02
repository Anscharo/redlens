// Regenerates src/data/common-words.txt — the word list that stops the reader's
// semantic search from waiting on a word that is already finished.
//
// WHAT IT CONTAINS, and why it is this small: the search worker only ever asks
// about a word that is a strict prefix of an atlas term and not a term itself
// (see `wordShape` in search.worker.ts). Every other word is already decided.
// So the list is exactly the intersection — ordinary English words that THIS
// atlas's vocabulary would otherwise read as half-typed ("home", "care",
// "govern"). That is ~1.4k words / 8 KB, against 344 KB for the 44k-word
// frequency list it is cut from, and it rescues every one of them rather than
// the measured 98% a bare frequency cut-off reaches.
//
// DRIFT is by design and costs nothing that matters: when the atlas gains a
// term some English word is now a prefix of, that word is missing here and the
// reader waits 1200ms instead of 400ms once. It is never a wrong answer, so the
// list does not need to track atlas bumps — re-run this when it feels stale.
//
// Deliberately OFF the `pnpm build` chain, like `chains:add`: the build is
// offline and byte-reproducible (REPRO=1), so the fetch happens here and the
// result is committed as data.
//
// Usage: pnpm words:fetch [--dry-run]   (needs public/search-index.json — run
//        `pnpm build:index` first if the artifacts have not been built)
import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../../src/lib/searchOptions.ts";

// Two sources, because each one's junk is the other's filter. The dictionary
// alone is full of fragments ("abl", "accum", "absorpt") that this list must
// never call finished words; the frequency list alone is subtitle text, so it
// carries common misspellings ("wher", "shari", "misa"). A word has to appear
// in both.
//
// Both kinds of mistake are survivable, and NOT symmetrically: a word wrongly
// called finished just restores what the search did before this list existed
// (one embed on a fragment), while a real word wrongly called half-typed makes
// the reader wait 800ms for nothing. So the intersection leans permissive.
const FREQ_SOURCE = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt";
const FREQ_LICENSE = "MIT — hermitdave/FrequencyWords (OpenSubtitles 2018 frequency list)";
const DICT_SOURCE = "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt";
const DICT_LICENSE = "Unlicense — dwyl/english-words";
const INDEX = path.join(process.cwd(), "public", "search-index.json");
const OUT = path.join(process.cwd(), "src", "data", "common-words.txt");

// Three characters is the shortest query the semantic lane will embed at all
// (MIN_SEMANTIC_QUERY), so a shorter word can never be the one being waited on.
const WORD_RE = /^[a-z]{3,}$/;

if (!fs.existsSync(INDEX)) throw new Error(`${INDEX} not found — run \`pnpm build:index\` first`);
const idx = MiniSearch.loadJSON(fs.readFileSync(INDEX, "utf8"), MINISEARCH_OPTIONS);
// MiniSearch's term dictionary, the same radix tree the worker probes. Reading
// `_index` keeps this generator and that probe reading ONE vocabulary; deriving
// the terms some other way here would let the two disagree about what a term is.
const terms = idx._index;

async function fetchWords(url, pick) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return (await res.text()).split("\n").map(pick).filter((w) => WORD_RE.test(w));
}

const ranked = await fetchWords(FREQ_SOURCE, (line) => line.split(" ")[0]?.trim().toLowerCase() ?? "");
if (ranked.length < 20_000) throw new Error(`only ${ranked.length} ranked words came back — refusing to write a truncated list`);
const dictionary = new Set(await fetchWords(DICT_SOURCE, (w) => w.trim().toLowerCase()));
if (dictionary.size < 100_000) throw new Error(`only ${dictionary.size} dictionary words came back — refusing to write a truncated list`);

const kept = ranked.filter(
  (w) => dictionary.has(w) && !terms.has(w) && !terms.atPrefix(w).keys().next().done,
);
if (kept.length < 200) throw new Error(`only ${kept.length} words survived the intersection — the index looks wrong`);

const body =
  [
    `# English words this atlas's own vocabulary would otherwise read as half typed.`,
    `# Regenerate with: pnpm words:fetch   (see scripts/aux/fetch-common-words.mjs)`,
    `# Sources: ${FREQ_SOURCE}`,
    `#          ${DICT_SOURCE}`,
    `# License: ${FREQ_LICENSE}`,
    `#          ${DICT_LICENSE}`,
    `# Kept ${kept.length} of ${ranked.length} ranked words: in both sources, and STARTING an atlas term without being one.`,
    `# Read by apps/web/src/workers/commonWords.ts. Lines beginning with # are skipped.`,
    ...kept.sort(),
  ].join("\n") + "\n";

if (process.argv.includes("--dry-run")) {
  console.log(`${kept.length} words, ${(body.length / 1024).toFixed(1)} KB (not written)`);
} else {
  fs.writeFileSync(OUT, body);
  console.log(`wrote ${OUT} — ${kept.length} words, ${(body.length / 1024).toFixed(1)} KB`);
}
