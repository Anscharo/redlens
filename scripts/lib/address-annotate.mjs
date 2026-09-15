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
 *
 * entityLabel is a plausible NAME or null — never a clause. Every return path
 * is gated on isPlausibleName(), the build-side twin of isCleanLabel()
 * (src/lib/addressName.ts); see docs/plans/entitylabel-fragment-defect.md.
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

// What a "." means inside a name. A dot is punctuation only when it ENDS A
// SENTENCE — letter, ".", optional closing quote/bracket, space, capitalised
// word ("…into WETH. Its address is"). A dot between letters ("Sky.money",
// "U.S.A") or touching a digit ("v1.5", "0.75") is part of the token.
//
// This matters because the capture below is non-greedy and walks BACKWARDS to
// the first capital: let it cross a sentence end and it swallows the sentence
// before the name, which is exactly how `entityLabel` used to ship clauses
// (docs/plans/entitylabel-fragment-defect.md). So a name may contain a dot —
// just never one that starts a new sentence.
//
// The capitalised word is NOT required to be Capital-then-lowercase: an acronym
// starts a sentence too ("…deposits assets. ALM Proxy's address is"), and
// letting the walk cross that one costs the whole label (the clause it captures
// fails isPlausibleName, so the answer becomes null) where stopping at it costs
// at most a leading acronym. Same reason isPlausibleName treats any ". " as a
// break: erring toward "this is a sentence" only ever shortens a name.
const NAME_CHAR = `(?:[A-Za-z0-9 &'’-]|\\.(?!["')\\]]?\\s+[A-Z]))`;
const NAME = `([A-Z]${NAME_CHAR}{2,60}?)`;
const NAME_GREEDY = `([A-Z]${NAME_CHAR}{2,60})`;

// Entity label patterns — try to pull a proper-noun phrase near the address.
// Each captures group 1 = the entity name.
const ENTITY_PATTERNS = [
  // "address of the X is" / "address of X is"
  new RegExp(`\\baddress\\s+of\\s+(?:the\\s+)?${NAME}\\s+(?:is|on|at)\\b`),
  // "the X address is" / "X's address is"
  new RegExp(`\\b(?:the\\s+)?${NAME}(?:['’]s)?\\s+address\\s+(?:is|on)\\b`),
  // "reward address for (the) X is" (Integration Boost / partner phrasing)
  new RegExp(`\\breward\\s+address\\s+for\\s+(?:the\\s+)?${NAME}\\s+is\\b`),
  // "X at address"
  new RegExp(`\\b${NAME}\\s+at\\s+address\\b`),
  // "Recipient: X" / "Multisig: X" — keyword match is case-insensitive
  new RegExp(
    `\\b(?:Recipient|Multisig|Operator|Owner|Controller|Executor)\\s*[:-]\\s*${NAME_GREEDY}`,
    "i",
  ),
  // Markdown bold/italic name immediately followed by colon: **X:** or *X:*
  new RegExp(`\\*\\*${NAME}\\*\\*\\s*[:-]`),
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

// Function words that, at the very end of a phrase, mark it as a dangling prose
// fragment rather than a name ("…into WETH. It", "…Pause Proxy. The").
const TRAILING_PROSE =
  /\b(it|its|the|this|that|these|those|a|an|and|or|of|to|for|from|into|via|with|through|is|are|be|as|at|by|on|in)$/i;

// A bare pronoun is never a name. Once the possessive is tightened, "Its address
// on Ethereum is …" parses as the entity "Its" — reject it outright.
const EXACT_PRONOUN = /^(The|This|That|These|Those|It|Its|It['’]s)$/i;

/**
 * True when `label` looks like a real name rather than a scraped prose fragment.
 *
 * Build-side twin of `isCleanLabel` in src/lib/addressName.ts: the two must stay
 * byte-identical in their predicates (same bounds, same TRAILING_PROSE list,
 * same sentence-break regex, same pronoun list): the sync gate is
 * scripts_tests/label-predicate-sync.test.ts, which runs one fixture list
 * through both and fails if they disagree. Two copies, not one module — the
 * pipeline is Node ESM under scripts/, the display filter is TS under src/, and
 * apps/web must not take a packaging dependency on scripts/.
 *
 * Prefer null over a consolation fragment — Phase 4.5 then gets a chance to fill
 * the slot from an ICD param, an entity name, a parent/doc title, or the chainlog.
 */
export function isPlausibleName(label) {
  if (!label) return false;
  const s = String(label).trim();
  if (s.length < 3 || s.length > 48) return false; // too short to mean anything / too long to be a name
  if (/[.?!]["')\]]?\s/.test(s)) return false; // an internal sentence break — the strongest fragment tell
  if (/^[a-z]/.test(s)) return false; // names are Title-Cased or all-caps; prose fragments start lowercase
  if (TRAILING_PROSE.test(s)) return false; // ends on a dangling function word
  if (EXACT_PRONOUN.test(s)) return false; // a bare pronoun, not a name
  return true;
}

// Column-header keywords that suggest the cell contains a human-readable name.
// Prose columns ("description", "details", "purpose") are deliberately absent:
// a Purpose cell is a sentence, and a sentence is not an owner name.
const LABEL_HEADER_KEYWORDS = [
  "name", "label", "entity", "role", "party", "who",
  "organization", "contract", "subject",
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

  // A pattern that fires on prose is not a hit: fall through to the next one
  // (and then to the table) rather than shipping the clause it captured.
  for (const re of ENTITY_PATTERNS) {
    const m = before.match(re);
    if (m && m[1]) {
      const label = m[1].trim().replace(/\s+/g, " ");
      if (isPlausibleName(label)) return label;
    }
  }

  if (table) {
    const { cells, headers, columnIndex } = table;
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const hdr = (headers[i] || "").toLowerCase();
      if (LABEL_HEADER_KEYWORDS.some((k) => hdr.includes(k))) {
        const val = cleanCellLabel(cells[i]);
        if (isPlausibleName(val) && !looksLikeAddress(val) && !looksLikeNumber(val)) return val;
      }
    }
    // Generic sibling-cell fallback: no header said "name", so the plausibility
    // check is the only thing standing between a Purpose paragraph and a label.
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const val = cleanCellLabel(cells[i]);
      if (isPlausibleName(val) && !looksLikeAddress(val) && !looksLikeNumber(val)) return val;
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
