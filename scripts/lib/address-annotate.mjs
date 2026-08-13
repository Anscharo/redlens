/**
 * Per-address annotation: structural roles and entity labels from doc content.
 *
 * Called from build-graph (Phase 2.6), not build-index. This module is purely
 * about what an address IS (contract architecture, purpose) — not who owns it
 * (affiliation/entity context comes from graph edges in Phase 4.5).
 *
 * Three independent passes per address occurrence:
 *   1. roles          — structural tags from a closed vocabulary
 *   2. entityLabel    — best-effort proper-noun phrase from preceding text
 *   3. expectedTokens — text-derived guess at which ERC20s this address holds
 */

import {
  annotationWindow,
  ETH_ADDR_EXACT_RE,
  SOL_ADDR_EXACT_RE,
} from "./address-chains.mjs";

// Closed-vocabulary structural role tags. Each address collects every tag whose
// pattern fires within the annotation window. Affiliation tags (sky, spark,
// external, etc.) are intentionally absent — entity ownership comes from graph
// edges, not text heuristics.
const ROLE_VOCAB = {
  // --- Wallet type ---
  multisig: [/\bmulti-?sig\b/i],
  subproxy: [/\bsub-?proxy\b/i],
  "hot-wallet": [/\bhot[- ]wallet\b/i],

  // --- Contract type ---
  // proxy uses negative lookbehind to avoid double-matching with subproxy
  proxy: [/\b(?<!sub-?)proxy\b/i],
  registry: [/\bregistry\b/i],
  oracle: [/\boracle\b/i, /\bprice[- ]feed\b/i],

  // --- Purpose ---
  treasury: [/\btreasury\b/i],
  buffer: [/\bbuffer\b/i],
  reserve: [/\breserves?\b/i],
  vesting: [/\bvesting\b/i],
  vault: [/\bvault\b/i],
  foundation: [/\bfoundation\b/i],
  "incentive-pool": [/\bincentive[\s-]+pool\b/i],
  "staking-rewards": [/\bstaking[\s-]+rewards?\b/i],

  // --- Signer / governance ---
  signer: [/\bsigner\b/i],
  delegate: [/\bdelegate\b/i],
  executor: [/\bexecutor\b/i],
  controller: [/\bcontroller\b/i],
};

// Known token symbols — case-sensitive (sUSDS ≠ USDS).
// Includes all current agent tokens extracted from Agent Token ICDs.
const TOKEN_SYMBOLS = [
  "USDS", "DAI", "SKY", "MKR", "sUSDS", "stUSDS", "USDC", "ETH", "WETH",
  "SPK", "GROVE", "KEEL", "OBEX", "PATTERN", "SKYBASE",
];

const TOKEN_RE = new RegExp(
  `\\b(${TOKEN_SYMBOLS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "g",
);

// Entity label patterns — try to pull a proper-noun phrase near the address.
// Each captures group 1 = the entity name.
const ENTITY_PATTERNS = [
  // "address of the X is" / "address of X is"
  /\baddress\s+of\s+(?:the\s+)?([A-Z][A-Za-z0-9 .&''’-]{2,60}?)\s+(?:is|on|at)\b/,
  // "the X address is" / "X's address is"
  /\b(?:the\s+)?([A-Z][A-Za-z0-9 .&''’-]{2,60}?)[''']?s?\s+address\s+(?:is|on)\b/,
  // "reward address for (the) X is" (Integration Boost / partner phrasing)
  /\breward\s+address\s+for\s+(?:the\s+)?([A-Z][A-Za-z0-9 .&''’-]{2,60}?)\s+is\b/,
  // "X at address"
  /\b([A-Z][A-Za-z0-9 .&''’-]{2,60}?)\s+at\s+address\b/,
  // "Recipient: X" / "Multisig: X" — keyword match is case-insensitive
  /\b(?:Recipient|Multisig|Operator|Owner|Controller|Executor)\s*[:-]\s*([A-Z][A-Za-z0-9 .&''’-]{2,60})/i,
  // Markdown bold/italic name immediately followed by colon: **X:** or *X:*
  /\*\*([A-Z][A-Za-z0-9 .&''’-]{2,60}?)\*\*\s*[:-]/,
];

// Combined text for pattern scanning: the sliding window plus any table cells
// and headers (if the address lives in a table).
function annotationText(content, matchIndex, addrLength, table) {
  let text = annotationWindow(content, matchIndex, addrLength);
  if (table) {
    if (table.headers.length) text += "\n" + table.headers.join(" | ");
    text += "\n" + table.cells.join(" | ");
  }
  return text;
}

export function extractRoles(content, matchIndex, addrLength, table) {
  const text = annotationText(content, matchIndex, addrLength, table);
  const tags = [];
  for (const [tag, patterns] of Object.entries(ROLE_VOCAB)) {
    if (patterns.some((p) => p.test(text))) tags.push(tag);
  }
  return tags;
}

// Column-header keywords that suggest the cell contains a human-readable name.
const LABEL_HEADER_KEYWORDS = [
  "name", "label", "entity", "description", "role", "party", "who",
  "organization", "contract", "subject", "details", "purpose",
];

function cleanCellLabel(cell) {
  return cell
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAddress(val) {
  return ETH_ADDR_EXACT_RE.test(val) || SOL_ADDR_EXACT_RE.test(val);
}
function looksLikeNumber(val) {
  return /^[0-9.,%$]+$/.test(val);
}

export function extractEntityLabel(content, matchIndex, table) {
  const start = Math.max(0, matchIndex - 200);
  const before = content.slice(start, matchIndex);

  for (const re of ENTITY_PATTERNS) {
    const m = before.match(re);
    if (m && m[1]) {
      const label = m[1].trim().replace(/\s+/g, " ");
      if (label.length >= 3 && !/^(The|This|That|These|Those|It)$/i.test(label)) return label;
    }
  }

  if (table) {
    const { cells, headers, columnIndex } = table;
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const hdr = (headers[i] || "").toLowerCase();
      if (LABEL_HEADER_KEYWORDS.some((k) => hdr.includes(k))) {
        const val = cleanCellLabel(cells[i]);
        if (val.length >= 3 && !looksLikeAddress(val) && !looksLikeNumber(val)) return val;
      }
    }
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const val = cleanCellLabel(cells[i]);
      if (val.length >= 3 && !looksLikeAddress(val) && !looksLikeNumber(val)) return val;
    }
  }

  return null;
}

export function extractExpectedTokens(content, matchIndex, addrLength, table) {
  const text = annotationText(content, matchIndex, addrLength, table);
  const found = new Set();
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) found.add(m[1]);
  return [...found];
}
