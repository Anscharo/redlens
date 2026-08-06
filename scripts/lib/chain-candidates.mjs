/**
 * Address-anchored chain-candidate detection — the drift detector for chain
 * names the label and prose halves of check-chains-census.mjs structurally
 * cannot see.
 *
 * Why this exists: the census's prose scan anchors on `<Proper Noun>
 * Chain|Network|Mainnet|Rollup|L2`, so it only ever sees *two-word* chain
 * references. Every single-word chain name — Unichain, Optimism, Base, Solana,
 * Plasma, Monad — is invisible to it unless the atlas also happens to write it
 * into a structured `Token Address (X)` / `Network` param. Unichain was exactly
 * that miss: three addresses were being attributed to it while the census
 * reported it "not seen in this atlas build", because its only appearance in
 * the atlas was a bullet row reading "- Unichain - `0x…`".
 *
 * This detector inverts the question. Instead of asking "does this text look
 * like a chain name" — which needs to already know the name, and so cannot
 * detect drift by construction — it asks "is this an address list keyed by
 * chain, and does one row name a chain the registry has never heard of?".
 *
 * A run of consecutive address-bearing lines whose row labels name two or more
 * *distinct* known chains IS a per-chain address list. That makes a sibling row
 * naming no chain at all a strong candidate for a missing chain — and the whole
 * point is that its name never had to be guessed in advance. It also self-heals:
 * once the chain is added to the registry its row stops being odd.
 */
import { CHAIN_HINTS, ETH_ADDR_RE, SOL_ADDR_RE } from "./address-chains.mjs";
import { CHAINS, FUTURE_TO_ETHEREUM } from "./chains.mjs";

/** Longest label kept for a residue row — enough to read, short enough to key on. */
const MAX_LABEL = 60;

const wordBoundary = (alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

// Chain matchers, word-boundary throughout (a row label is free text, so
// "Database" must not read as base). CHAIN_HINTS is preferred wherever it has
// an entry — it carries the hand-tuned exclusions, notably gnosis's
// `(?!\s+(?:safe|protocol))` — and CHAINS aliases only fill in the chains it
// deliberately omits. Solana is the one such chain: detectChain never runs on
// it (base58 shape attributes it instead), so it has no CHAIN_HINTS entry, but
// a "- Solana - <addr>" row still names a chain we know and must not be
// reported as odd. FUTURE_TO_ETHEREUM names count as named too — a deferred
// chain is a known-about chain, not a missing one.
const hintChains = new Set(CHAIN_HINTS.map((h) => h.chain));
const MATCHERS = [
  ...CHAIN_HINTS.map((h) => ({ chain: h.chain, patterns: h.patterns })),
  ...CHAINS.filter((c) => !hintChains.has(c.chain)).map((c) => ({
    chain: c.chain,
    patterns: c.aliases.map(wordBoundary),
  })),
  ...FUTURE_TO_ETHEREUM.map((f) => ({ chain: "ethereum", patterns: [wordBoundary(f)] })),
];

/** The chain a row label names, or null when it names none. Word-boundary only. */
export function chainNamedIn(label) {
  if (!label) return null;
  for (const { chain, patterns } of MATCHERS) {
    if (patterns.some((p) => p.test(label))) return chain;
  }
  return null;
}

/**
 * The offset of the first address literal in a line, or -1. Fresh regex objects:
 * ETH_ADDR_RE / SOL_ADDR_RE are shared /g patterns whose lastIndex must not be
 * mutated out from under a caller mid-iteration.
 */
function firstAddressAt(line) {
  const eth = new RegExp(ETH_ADDR_RE.source).exec(line);
  const sol = new RegExp(SOL_ADDR_RE.source).exec(line);
  const idxs = [eth?.index, sol?.index].filter((i) => i != null);
  return idxs.length ? Math.min(...idxs) : -1;
}

/**
 * The row label: the line text preceding the address, stripped of list markers,
 * table pipes, and the punctuation atlas rows use to separate label from value
 * ("- Unichain - `0x…`" → "Unichain"; "| Base | `0x…` |" → "Base").
 */
export function rowLabel(prefix) {
  return prefix
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^\s*\|/, "")
    .replace(/[\s:,\-–—`'"*([|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Runs of consecutive address-bearing lines. Blank lines are tolerated (a
 * loosely-spaced bullet list is still one list); any other non-address line
 * closes the run, so a table's header and separator rows bound the data rows
 * rather than joining them to unrelated prose above.
 */
function addressBlocks(content) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const at = firstAddressAt(line);
    if (at !== -1) {
      current.push({ line: i + 1, label: rowLabel(line.slice(0, at)) });
    } else if (line.trim() !== "") {
      flush();
    }
  }
  flush();
  return blocks;
}

/**
 * Rows in a chain-keyed address list that name no chain the registry knows.
 *
 * Gate: the block must hold at least two *distinct* named chains. One repeated
 * chain name is an entity list that happens to mention a chain, not a list
 * keyed by chain — requiring two distinct ones is what keeps the false-positive
 * rate near zero without ever needing to know the missing chain's name.
 *
 * Returns `{ label, line, siblings }` per odd row, where `siblings` are the
 * known chains its list names — the evidence a human needs to judge the row.
 */
export function findChainKeyedOddRows(content) {
  if (!content) return [];
  const odd = [];

  for (const block of addressBlocks(content)) {
    // Two named rows plus at least one odd row: shorter blocks cannot qualify.
    if (block.length < 3) continue;

    const rows = block.map((r) => ({ ...r, chain: chainNamedIn(r.label) }));
    const named = [...new Set(rows.filter((r) => r.chain).map((r) => r.chain))].sort();
    if (named.length < 2) continue;

    for (const r of rows) {
      // An unlabelled row (a bare address on its own line) carries no claim to
      // judge — silence is not evidence of a missing chain.
      if (r.chain || !r.label) continue;
      odd.push({ label: r.label.slice(0, MAX_LABEL), line: r.line, siblings: named });
    }
  }

  return odd;
}
