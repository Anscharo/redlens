/**
 * Onchain address regex, normalization, chain detection, and table-context
 * detection for addresses sitting inside markdown tables.
 */
import { CHAIN_HINT_SPECS, FUTURE_TO_ETHEREUM } from "./chains.mjs";

// Address bodies as *source strings*. Exported so a caller that needs an
// address inside a larger pattern composes this instead of retyping it —
// retyping is exactly how un-anchored copies that matched the leading 40 hex of
// a transaction hash got into the pipeline.
export const ETH_ADDR_SRC = String.raw`0x[0-9a-fA-F]{40}`;
export const SOL_ADDR_SRC = String.raw`[1-9A-HJ-NP-Za-km-z]{43,44}`;

// EVM addresses are exactly 40 hex chars. The negative lookbehind/lookahead
// stop us from matching the leading 40 hex of a longer hex blob like a 64-hex
// transaction hash or raw calldata.
export const ETH_ADDR_RE = new RegExp(
  String.raw`(?<![0-9a-fA-F])${ETH_ADDR_SRC}(?![0-9a-fA-F])`,
  "g",
);
// Base58, 43-44 chars, word boundary — covers standard Solana pubkeys
export const SOL_ADDR_RE = new RegExp(String.raw`\b${SOL_ADDR_SRC}\b`, "g");

// Non-global sibling for callers that want the FIRST address in a string.
// Separate object on purpose: the /g regexes carry `lastIndex` state, which
// this module already treats as a hazard (see afterLastAddress).
export const ETH_ADDR_FIRST_RE = new RegExp(ETH_ADDR_RE.source);

// Whole-string tests — "is this value, in its entirety, an address?". Used for
// ICD parameter values and table cells, where the candidate is already isolated.
export const ETH_ADDR_EXACT_RE = new RegExp(String.raw`^${ETH_ADDR_SRC}$`);
export const SOL_ADDR_EXACT_RE = new RegExp(String.raw`^${SOL_ADDR_SRC}$`);

// EVM addresses are case-insensitive (EIP-55 is a display checksum, not an
// identifier). Normalize to lowercase so the same address written in different
// casings merges into one entry. Solana base58 is case-sensitive — leave it.
export function normalizeAddress(addr) {
  return addr.startsWith("0x") ? addr.toLowerCase() : addr;
}
const WINDOW = 300; // chars before the address to scan for chain hints

// Prose chain-hint patterns for detectChain, compiled from the canonical
// registry (src/data/chain-registry.json via chains.mjs CHAIN_HINT_SPECS).
// Deliberately a separate *algorithm* from normalizeChainLabel — it scans free
// prose with word-boundary regexes (so "base" inside "database" doesn't match)
// and orders ethereum FIRST (an "ethereum mainnet" context should win), the
// opposite of label normalization — but no longer a separately maintained
// *list*: a chain added to the registry gets its hints automatically.
//
// An exclusion becomes a negative lookahead. The one in use: "Gnosis Safe" (the
// multisig, on any chain) and "Gnosis Protocol" (the DEX) are not Gnosis Chain
// — without it they pinned mainnet Safes and the Distribution Reward instances
// to gnosis.
export const CHAIN_HINTS = CHAIN_HINT_SPECS.map(({ chain, hints, exclusions }) => ({
  chain,
  patterns: hints.map((h) => {
    const excl = exclusions[h];
    const tail = excl?.length ? `(?!\\s+(?:${excl.join("|")}))` : "";
    return new RegExp(`\\b${h}\\b${tail}`, "i");
  }),
}));

// Trailing punctuation between the "... is" clause and the address literal:
// atlas prose writes "is: `0x…`", "is - 0x…", "is (0x…)".
const TRAILING_JUNK_RE = /[\s:,\-–`'"*([]+$/;

/**
 * The chain named by the "on <phrase> is" clause immediately before the address
 * — the most reliable signal, because the author stated it explicitly.
 *
 * Deliberately anchored on "on ... is", NOT "address on ... is": atlas prose
 * overwhelmingly reads "The address of the <long entity name> on <Chain> is:",
 * so requiring `address` adjacent to `on` missed nearly every real sentence and
 * left those addresses to the keyword scan, which picks by registry order and
 * so returns whichever chain the *entity name* happens to mention first (a
 * "Grove Arbitrum governance relay receiver on Robinhood Chain" landed on
 * arbitrum).
 *
 * Takes the LAST "on" so the nearest clause wins, and returns the phrase for
 * the caller to keyword-match — an enumeration ("on the Ethereum Mainnet, Base,
 * and Arbitrum is", one address deployed to all three) still resolves by
 * registry order, which puts ethereum first.
 *
 * Written procedurally rather than as one regex: the equivalent pattern needs a
 * whitespace-inclusive non-greedy phrase class next to `\s+is`, whose overlap
 * backtracks catastrophically on the many windows that never match.
 */
function explicitChainPhrase(tight) {
  const trimmed = tight.replace(TRAILING_JUNK_RE, "");
  if (!/\bis$/i.test(trimmed)) return null;
  const head = trimmed.slice(0, -2);
  const onIdx = head.toLowerCase().lastIndexOf(" on ");
  if (onIdx === -1) return null;
  const phrase = head.slice(onIdx + 4).trim().replace(/^the\s+/i, "");
  return phrase.length >= 2 && phrase.length <= 60 ? phrase : null;
}

function firstChainIn(text) {
  for (const { chain, patterns } of CHAIN_HINTS) {
    if (patterns.some((p) => p.test(text))) return chain;
  }
  return null;
}

// A known chain in `text`, or — failing that — a FUTURE_TO_ETHEREUM chain
// named in it (e.g. "Plasma"), reported as ethereum with the deferred name
// attached. Used by detectChainSignal so a deferred chain's own list row
// resolves to its documented ethereum collapse instead of falling through to
// whatever chain a neighboring row happens to name.
function firstSignalIn(text) {
  const chain = firstChainIn(text);
  if (chain) return { chain };
  const deferred = FUTURE_TO_ETHEREUM.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
  return deferred ? { chain: "ethereum", deferred } : null;
}

/**
 * The window segment after the last address literal in it. A chain named before
 * some *other* address belongs to that address, not this one — without this, a
 * per-chain list ("- Ethereum Mainnet - `0x…` - Arbitrum - `0x…`") attributes
 * every entry to whichever chain the first row named.
 */
function afterLastAddress(w) {
  // Fresh regex object: ETH_ADDR_RE is a shared /g regex, and mutating its
  // lastIndex would corrupt any caller mid-iteration over the same object.
  const re = new RegExp(ETH_ADDR_RE.source, "g");
  let last = -1;
  let m;
  while ((m = re.exec(w)) !== null) last = m.index + m[0].length;
  return last === -1 ? null : w.slice(last);
}

export function annotationWindow(content, matchIndex, addrLength) {
  // Uses ANNOT_WINDOW from address-annotate (300). Kept separate from WINDOW
  // (chain detection) for historical reasons — same value, different intent.
  const ANNOT_WINDOW = 300;
  const start = Math.max(0, matchIndex - ANNOT_WINDOW);
  const end = Math.min(content.length, matchIndex + addrLength + ANNOT_WINDOW);
  return content.slice(start, end);
}

// ---------------------------------------------------------------------------
// Markdown table detection
//
// Addresses inside markdown tables have their context hidden from the sliding
// window — headers can be far above the row, and entity names are in sibling
// cells rather than prose. `findTableContext` detects whether the address sits
// in a pipe-delimited row and, if so, returns the row cells, the header cells,
// and the index of the column containing the address.
// ---------------------------------------------------------------------------
function isTableRow(line) {
  return line.startsWith("|") && line.endsWith("|") && line.length > 2;
}
function isSeparatorRow(line) {
  return /^\|[\s\-:|]+\|$/.test(line);
}
function splitRow(line) {
  // Strip leading/trailing pipes, split, trim cells
  return line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

export function findTableContext(content, matchIndex) {
  const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
  let lineEnd = content.indexOf("\n", matchIndex);
  if (lineEnd === -1) lineEnd = content.length;
  const line = content.slice(lineStart, lineEnd);

  if (!isTableRow(line) || isSeparatorRow(line)) return null;

  const cells = splitRow(line);

  // Column index = count of pipes before the address position within the line
  const addrOffsetInLine = matchIndex - lineStart;
  let pipeCount = 0;
  for (let i = 0; i < addrOffsetInLine && i < line.length; i++) {
    if (line[i] === "|") pipeCount++;
  }
  const columnIndex = Math.max(0, Math.min(cells.length - 1, pipeCount - 1));

  // Walk upward to find the separator row; the line above it is the header
  let headers = [];
  let cursor = lineStart;
  while (cursor > 0) {
    const prevLineEnd = cursor - 1; // position of the \n before the current line
    if (prevLineEnd < 0) break;
    const prevLineStart = content.lastIndexOf("\n", prevLineEnd - 1) + 1;
    const prevLine = content.slice(prevLineStart, prevLineEnd);
    if (!isTableRow(prevLine)) break;
    if (isSeparatorRow(prevLine)) {
      // Header row sits immediately above the separator
      const hdrEnd = prevLineStart - 1;
      if (hdrEnd > 0) {
        const hdrStart = content.lastIndexOf("\n", hdrEnd - 1) + 1;
        const hdrLine = content.slice(hdrStart, hdrEnd);
        if (isTableRow(hdrLine) && !isSeparatorRow(hdrLine)) {
          headers = splitRow(hdrLine);
        }
      }
      break;
    }
    cursor = prevLineStart;
  }

  return { cells, headers, columnIndex };
}

/**
 * The chain a *label* names, or null when it names none.
 *
 * A doc/ancestor title is a label, not prose, so — like chains.mjs
 * `normalizeChainLabel` and unlike the prose scan — specific chains are checked
 * before ethereum, otherwise a "Base Mainnet - …" heading resolves to ethereum
 * on the `\bmainnet\b` hint. Matching stays word-boundary (CHAIN_HINTS) rather
 * than `normalizeChainLabel`'s substring test, because a doc title is free text
 * where "Database"/"Baserate" must not read as base.
 *
 * A deferred chain (FUTURE_TO_ETHEREUM) resolves to ethereum rather than null,
 * so an ancestor walk stops at the heading that named it instead of continuing
 * up to a grandparent that names something else.
 */
export function chainFromLabel(label) {
  if (!label) return null;
  for (const { chain, patterns } of CHAIN_HINTS) {
    if (chain === "ethereum") continue;
    if (patterns.some((p) => p.test(label))) return chain;
  }
  if (FUTURE_TO_ETHEREUM.some((c) => new RegExp(`\\b${c}\\b`, "i").test(label))) return "ethereum";
  return firstChainIn(label);
}

/**
 * The chain named in the prose around an address plus how firmly it was named,
 * or null when the prose names none.
 *
 * `explicit` means the author wrote an "on <chain> is" clause about this exact
 * address, which settles the question outright. Anything else is a keyword that
 * merely appeared nearby, which a heading may legitimately override or rival.
 * Callers supply the fallback — build-index walks the doc's own title and its
 * doc_no ancestors before defaulting, because atomized docs routinely put the
 * chain in the heading ("ALM Proxy (Optimism) Contract") and never repeat it in
 * the one-line body.
 */
export function detectChainSignal(content, matchIndex) {
  // Pass 1: explicit "on X is" clause in the 120 chars immediately before.
  const tight = content.slice(Math.max(0, matchIndex - 120), matchIndex);
  const phrase = explicitChainPhrase(tight);
  if (phrase) {
    const hit = firstChainIn(phrase);
    if (hit) return { chain: hit, explicit: true };
  }

  // Pass 2/3: first chain keyword (registry order) in the tight (120 chars) then
  // wide (300 chars) window. Each window is scanned from the last address
  // literal onward first, falling back to the whole window when that segment
  // names no chain — so trimming another address's context can only ever add a
  // signal, never remove the only one. A deferred chain (FUTURE_TO_ETHEREUM)
  // named in the scoped segment is checked before falling back to the whole
  // window, so e.g. "- Plasma - `0x…`" resolves to its own ethereum collapse
  // rather than to a preceding row's unrelated chain name.
  for (const win of [120, WINDOW]) {
    const w = content.slice(Math.max(0, matchIndex - win), matchIndex);
    const scoped = afterLastAddress(w);
    const hit = (scoped !== null ? firstSignalIn(scoped) : null) ?? firstSignalIn(w);
    if (hit) return { chain: hit.chain, explicit: false, ...(hit.deferred && { deferred: hit.deferred }) };
  }

  return null;
}

export function detectChainOrNull(content, matchIndex) {
  return detectChainSignal(content, matchIndex)?.chain ?? null;
}

export function detectChain(content, matchIndex) {
  return detectChainOrNull(content, matchIndex) ?? "ethereum";
}
