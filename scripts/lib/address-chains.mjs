/**
 * Onchain address regex, normalization, chain detection, and table-context
 * detection for addresses sitting inside markdown tables.
 */

// EVM addresses are exactly 40 hex chars. The negative lookbehind/lookahead
// stop us from matching the leading 40 hex of a longer hex blob like a 64-hex
// transaction hash or raw calldata.
export const ETH_ADDR_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
// Base58, 43-44 chars, word boundary — covers standard Solana pubkeys
export const SOL_ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;

// EVM addresses are case-insensitive (EIP-55 is a display checksum, not an
// identifier). Normalize to lowercase so the same address written in different
// casings merges into one entry. Solana base58 is case-sensitive — leave it.
export function normalizeAddress(addr) {
  return addr.startsWith("0x") ? addr.toLowerCase() : addr;
}
const WINDOW = 300; // chars before the address to scan for chain hints

// Prose chain-hint patterns for detectChain. Deliberately separate from the
// canonical chains.mjs registry / normalizeChainLabel: this scans free prose
// with word-boundary regexes (so "base" inside "database" doesn't match) and
// orders ethereum FIRST (an "ethereum mainnet" context should win), the opposite
// of label normalization. Keep the two in step when adding a chain.
// Ordered by specificity — more specific patterns first within each entry.
// Exported so census:chains can assert it stays in step with CHAINS.
export const CHAIN_HINTS = [
  { chain: "ethereum", patterns: [/\bethereum\b/i, /\bmainnet\b/i] },
  { chain: "base", patterns: [/\bbase\b/i] },
  { chain: "arbitrum", patterns: [/\barbitrum\b/i, /\barb\b/i] },
  { chain: "optimism", patterns: [/\boptimism\b/i, /\bop mainnet\b/i] },
  { chain: "polygon", patterns: [/\bpolygon\b/i, /\bmatic\b/i] },
  { chain: "avalanche", patterns: [/\bavalanche\b/i, /\bavax\b/i] },
  { chain: "gnosis", patterns: [/\bgnosis\b/i, /\bxdai\b/i] },
  { chain: "robinhood", patterns: [/\brobinhood\b/i] },
];

// "address on [the] CHAIN is 0x..." — most reliable signal
const EXPLICIT_RE = /\baddress\s+on\s+(?:the\s+)?(.{3,30}?)\s+is\s*$/i;

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

export function detectChain(content, matchIndex) {
  // Pass 1: explicit "address on X is" pattern in the 120 chars immediately before
  const tight = content.slice(Math.max(0, matchIndex - 120), matchIndex);
  const explicit = tight.match(EXPLICIT_RE);
  if (explicit) {
    const phrase = explicit[1].toLowerCase();
    for (const { chain, patterns } of CHAIN_HINTS) {
      if (patterns.some((p) => p.test(phrase))) return chain;
    }
  }

  // Pass 2: first chain keyword found in tight window (100 chars)
  for (const { chain, patterns } of CHAIN_HINTS) {
    if (patterns.some((p) => p.test(tight))) return chain;
  }

  // Pass 3: first chain keyword found in wide window (300 chars)
  const wide = content.slice(Math.max(0, matchIndex - WINDOW), matchIndex);
  for (const { chain, patterns } of CHAIN_HINTS) {
    if (patterns.some((p) => p.test(wide))) return chain;
  }

  return "ethereum";
}
