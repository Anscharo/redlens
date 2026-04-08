#!/usr/bin/env node
/**
 * Parses Sky Atlas.md and emits:
 *   public/docs.json        — id → node (uuid, doc_no, title, type, depth, parentId, content)
 *   public/search-index.json — serialized lunr index
 *
 * Run: node scripts/build-index.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import lunr from "lunr";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ATLAS_PATH = path.join(
  ROOT,
  "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md"
);
const OUT_DIR = path.join(ROOT, "public");

// ---------------------------------------------------------------------------
// Heading pattern: `## A.0.1 - Title [Type]  <!-- UUID: <uuid> -->`
// ---------------------------------------------------------------------------
const HEADING_RE =
  /^(#{1,6}) ([\w.]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$/;

// ---------------------------------------------------------------------------
// Onchain address extraction
// ---------------------------------------------------------------------------
const ETH_ADDR_RE = /0x[0-9a-fA-F]{40}/g;
// Base58, 43-44 chars, word boundary — covers standard Solana pubkeys
const SOL_ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;

// EVM addresses are case-insensitive (EIP-55 is a display checksum, not an
// identifier). Normalize to lowercase so the same address written in different
// casings merges into one entry. Solana base58 is case-sensitive — leave it.
function normalizeAddress(addr) {
  return addr.startsWith("0x") ? addr.toLowerCase() : addr;
}
const WINDOW = 300; // chars before the address to scan for chain hints

// Ordered by specificity — more specific patterns first within each entry
const CHAIN_HINTS = [
  { chain: "ethereum",  patterns: [/\bethereum\b/i, /\bmainnet\b/i] },
  { chain: "base",      patterns: [/\bbase\b/i] },
  { chain: "arbitrum",  patterns: [/\barbitrum\b/i, /\barb\b/i] },
  { chain: "optimism",  patterns: [/\boptimism\b/i, /\bop mainnet\b/i] },
  { chain: "polygon",   patterns: [/\bpolygon\b/i, /\bmatic\b/i] },
  { chain: "avalanche", patterns: [/\bavalanche\b/i, /\bavax\b/i] },
  { chain: "gnosis",    patterns: [/\bgnosis\b/i, /\bxdai\b/i] },
];

const EXPLORER = {
  ethereum:  "https://etherscan.io/address/",
  base:      "https://basescan.org/address/",
  arbitrum:  "https://arbiscan.io/address/",
  optimism:  "https://optimistic.etherscan.io/address/",
  polygon:   "https://polygonscan.com/address/",
  avalanche: "https://snowtrace.io/address/",
  gnosis:    "https://gnosisscan.io/address/",
  solana:    "https://explorer.solana.com/address/",
};

// "address on [the] CHAIN is 0x..." — most reliable signal
const EXPLICIT_RE = /\baddress\s+on\s+(?:the\s+)?(.{3,30}?)\s+is\s*$/i;

// ---------------------------------------------------------------------------
// Address annotation
//
// Three independent passes per address:
//   1. roles          — multi-label tags from a closed vocabulary
//   2. entityLabel    — best-effort proper-noun phrase pulled from preceding text
//   3. expectedTokens — text-derived guess at which ERC20s this address holds
//
// Roles, labeling, and holder detection are deliberately separate concerns.
// ---------------------------------------------------------------------------
const ANNOT_WINDOW = 300; // chars before+after address to inspect

// Closed-vocabulary role tags. Each address collects every tag whose pattern
// fires within ANNOT_WINDOW. Categories below are organizational only — the
// emitted tags are flat strings.
const ROLE_VOCAB = {
  // --- Affiliation (only emitted on a positive signal; no default) ---
  // "sky" only fires for proper-noun Sky entities, NOT bare mentions of "Sky"
  // (which appear in nearly every Atlas node and would be useless).
  sky: [
    /\bSky\s+(?:Frontier|Foundation|Ecosystem|Token|Governance|Star|Council|Aligned|Atlas|Operator)\b/,
    /\bAligned\s+Delegate\b/i,
  ],
  spark: [/\bSpark(?:Lend|FI)?\b/],
  maker: [/\bMaker(?:DAO)?\b/],
  grove: [/\bGrove\b/],
  // Safe Harbor is a Sky-adopted onchain agreement (A.2.11.1.2), NOT external.
  // LayerZero is infrastructure Sky uses, not a Sky-external entity — Sky's
  // LayerZero-adjacent multisigs are Sky-controlled, so "LayerZero" nearby
  // shouldn't flip an address to external.
  external: [
    /\bChainlink\b/i,
    /\bUniswap\b/i,
    /\bAave\b/i,
    /\bCurve\b/i,
    /\bMorpho\b/i,
    /\bGnosis\s+Safe\b/i,
  ],

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
  "incentive-pool": [/\bincentive\s+pool\b/i],
  "staking-rewards": [/\bstaking\s+rewards?\b/i],

  // --- Signer / governance ---
  signer: [/\bsigner\b/i],
  delegate: [/\bdelegate\b/i],
  executor: [/\bexecutor\b/i],
  controller: [/\bcontroller\b/i],
};

// Tokens we can plausibly query via viem. Case-sensitive — sUSDS / stUSDS are
// distinct from USDS, and we want to preserve the canonical casing.
const TOKEN_SYMBOLS = [
  "USDS", "DAI", "SKY", "MKR", "sUSDS", "stUSDS",
  "USDC", "ETH", "WETH", "SPK", "GROVE",
];

const TOKEN_RE = new RegExp(
  `\\b(${TOKEN_SYMBOLS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "g"
);

// Entity label patterns — try to pull a proper-noun phrase near the address
// Each captures group 1 = the entity name
const ENTITY_PATTERNS = [
  // "address of the X is" / "address of X is"
  /\baddress\s+of\s+(?:the\s+)?([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\s+(?:is|on|at)\b/,
  // "the X address is" / "X's address is"
  /\b(?:the\s+)?([A-Z][A-Za-z0-9 .&'’-]{2,60}?)['’]?s?\s+address\s+(?:is|on)\b/,
  // "reward address for (the) X is" (Integration Boost / partner phrasing)
  /\breward\s+address\s+for\s+(?:the\s+)?([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\s+is\b/,
  // "X at address"
  /\b([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\s+at\s+address\b/,
  // "Recipient: X" / "Multisig: X"
  /\b(?:Recipient|Multisig|Operator|Owner|Controller|Executor)\s*[:\-]\s*([A-Z][A-Za-z0-9 .&'’-]{2,60})/,
  // Markdown bold/italic name immediately followed by colon: **X:** or *X:*
  /\*\*([A-Z][A-Za-z0-9 .&'’-]{2,60}?)\*\*\s*[:\-]/,
];

function annotationWindow(content, matchIndex, addrLength) {
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
  return line.slice(1, -1).split("|").map((c) => c.trim());
}

function findTableContext(content, matchIndex) {
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

// Combined text for pattern scanning: the sliding window plus any table cells
// and headers (if the address lives in a table). Lets role/token regex see
// header words that would otherwise be far outside ANNOT_WINDOW.
function annotationText(content, matchIndex, addrLength, table) {
  let text = annotationWindow(content, matchIndex, addrLength);
  if (table) {
    if (table.headers.length) text += "\n" + table.headers.join(" | ");
    text += "\n" + table.cells.join(" | ");
  }
  return text;
}

// Tags that mean "this address belongs to a Sky-ecosystem org"
const SKY_ALIGNED_TAGS = new Set(["sky", "spark", "grove", "maker"]);

function extractRoles(content, matchIndex, addrLength, table) {
  const text = annotationText(content, matchIndex, addrLength, table);
  let tags = [];
  for (const [tag, patterns] of Object.entries(ROLE_VOCAB)) {
    if (patterns.some((p) => p.test(text))) tags.push(tag);
  }
  // "external" means outside the Sky system — mutually exclusive with any
  // Sky-aligned tag. If both fire, the Sky-aligned signal wins.
  if (tags.includes("external") && tags.some((t) => SKY_ALIGNED_TAGS.has(t))) {
    tags = tags.filter((t) => t !== "external");
  }
  return tags;
}

// Column-header keywords that suggest the cell contains a human-readable name
// for the row's subject.
const LABEL_HEADER_KEYWORDS = [
  "name", "label", "entity", "description", "role", "party",
  "who", "organization", "contract", "subject", "details", "purpose",
];

function cleanCellLabel(cell) {
  // Strip common markdown wrapping and escape-chars from a cell value
  return cell
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^__(.*?)__$/, "$1")
    .replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1") // strip markdown links
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAddress(val) {
  return /^0x[0-9a-fA-F]{40}$/.test(val) || /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(val);
}
function looksLikeNumber(val) {
  return /^[0-9.,%$]+$/.test(val);
}

function extractEntityLabel(content, matchIndex, table) {
  // Pass 1: prose patterns in the 200 chars immediately preceding the address
  const start = Math.max(0, matchIndex - 200);
  const before = content.slice(start, matchIndex);

  for (const re of ENTITY_PATTERNS) {
    const m = before.match(re);
    if (m && m[1]) {
      const label = m[1].trim().replace(/\s+/g, " ");
      if (label.length >= 3 && !/^(The|This|That|These|Those|It)$/i.test(label)) {
        return label;
      }
    }
  }

  // Pass 2: if the address sits in a markdown table row, use sibling cells
  if (table) {
    const { cells, headers, columnIndex } = table;

    // 2a: prefer a cell whose header contains a label-ish keyword
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const hdr = (headers[i] || "").toLowerCase();
      if (LABEL_HEADER_KEYWORDS.some((k) => hdr.includes(k))) {
        const val = cleanCellLabel(cells[i]);
        if (val.length >= 3 && !looksLikeAddress(val) && !looksLikeNumber(val)) {
          return val;
        }
      }
    }

    // 2b: fall back to the first sibling cell that isn't an address / number / empty
    for (let i = 0; i < cells.length; i++) {
      if (i === columnIndex) continue;
      const val = cleanCellLabel(cells[i]);
      if (val.length >= 3 && !looksLikeAddress(val) && !looksLikeNumber(val)) {
        return val;
      }
    }
  }

  return null;
}

// Text-derived guess at which ERC20s this address should hold. Independent of
// roles — an address with no role tags can still have expectedTokens (and vice
// versa). The plan is to use this list to drive viem balanceOf() calls.
function extractExpectedTokens(content, matchIndex, addrLength, table) {
  const text = annotationText(content, matchIndex, addrLength, table);
  const found = new Set();
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

function detectChain(content, matchIndex) {
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

// Returns { normalizedAddress → { chain, explorerUrl, roles, entityLabel, expectedTokens } }
// Keys are lowercase for EVM, original case for Solana. See normalizeAddress.
function extractAddresses(content) {
  const result = {};

  // EVM addresses (0x-prefixed)
  ETH_ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ETH_ADDR_RE.exec(content)) !== null) {
    const addr = m[0];
    const key = normalizeAddress(addr);
    if (result[key]) continue;
    const chain = detectChain(content, m.index);
    const table = findTableContext(content, m.index);
    result[key] = {
      chain,
      explorerUrl: EXPLORER[chain] + key,
      roles: extractRoles(content, m.index, addr.length, table),
      entityLabel: extractEntityLabel(content, m.index, table),
      expectedTokens: extractExpectedTokens(content, m.index, addr.length, table),
    };
  }

  // Solana addresses (base58, 43-44 chars) — assumed Solana by pattern alone
  SOL_ADDR_RE.lastIndex = 0;
  while ((m = SOL_ADDR_RE.exec(content)) !== null) {
    const addr = m[0];
    const key = normalizeAddress(addr);
    if (result[key]) continue;
    const table = findTableContext(content, m.index);
    result[key] = {
      chain: "solana",
      explorerUrl: EXPLORER.solana + key,
      roles: extractRoles(content, m.index, addr.length, table),
      entityLabel: extractEntityLabel(content, m.index, table),
      expectedTokens: extractExpectedTokens(content, m.index, addr.length, table),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Global address merge
//
// Per-node extraction produces different annotations depending on the local
// context. The same address can have a rich label in one node (e.g. "Spark
// Operations Multisig" from a prose sentence) and nothing in another (e.g. a
// bare address in a Setter leaf node). This pass merges every address's
// annotation data across all nodes into a single canonical entry, then rewrites
// each node's address map to point at that entry. After this pass, looking up
// an address in any node yields the same label / roles / tokens.
// ---------------------------------------------------------------------------
function mergeAddressAnnotations(nodes) {
  // Pass 1 — aggregate every occurrence into a global table
  const global = {}; // key → { chains: Set, labels: Set, roles: Set, tokens: Set }

  for (const node of nodes) {
    for (const [addr, info] of Object.entries(node.addresses || {})) {
      let g = global[addr];
      if (!g) {
        g = global[addr] = {
          chains: new Set(),
          labels: new Set(),
          roles: new Set(),
          tokens: new Set(),
        };
      }
      g.chains.add(info.chain);
      if (info.entityLabel) g.labels.add(info.entityLabel);
      for (const r of info.roles) g.roles.add(r);
      for (const t of info.expectedTokens) g.tokens.add(t);
    }
  }

  // Pass 2 — canonicalize each entry
  const GENERIC_LABELS = new Set([
    "contract", "address", "registry", "multisig", "the contract",
    "the address", "the multisig", "agreement",
  ]);
  const merged = {};
  for (const [addr, g] of Object.entries(global)) {
    // Chain: prefer any non-default detection over the ethereum fallback.
    // If only "ethereum" was ever detected, keep it.
    const chains = [...g.chains];
    const specific = chains.find((c) => c !== "ethereum");
    const chain = specific ?? chains[0] ?? "ethereum";

    // Label: filter out generic single-word labels; pick the longest remaining.
    // Ties broken by lexicographic order for determinism.
    const labelPool = [...g.labels];
    const nonGeneric = labelPool.filter(
      (l) => !GENERIC_LABELS.has(l.toLowerCase())
    );
    const candidates = nonGeneric.length ? nonGeneric : labelPool;
    let entityLabel = null;
    if (candidates.length) {
      candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));
      entityLabel = candidates[0];
    }

    const aliases = entityLabel
      ? [...new Set(labelPool.filter((l) => l !== entityLabel).map((l) => l.trim()))].sort()
      : [];

    merged[addr] = {
      chain,
      explorerUrl: EXPLORER[chain] + addr,
      roles: [...g.roles].sort(),
      entityLabel,
      aliases,
      expectedTokens: [...g.tokens].sort(),
    };
  }

  // Pass 3 — rewrite every node's address map to point at merged entries
  for (const node of nodes) {
    if (!node.addresses) continue;
    const rewritten = {};
    for (const addr of Object.keys(node.addresses)) {
      rewritten[addr] = merged[addr];
    }
    node.addresses = rewritten;
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
function parse(src) {
  const lines = src.split("\n");
  const nodes = []; // ordered list of nodes as we encounter headings
  const nodeMap = {}; // uuid → node

  let current = null; // node currently accumulating content lines

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      // Seal previous node's content
      if (current) {
        current.content = cleanContent(current._lines);
        delete current._lines;
      }

      const depth = m[1].length;
      const node = {
        id: m[5],
        doc_no: m[2],
        title: m[3].trim(),
        type: m[4],
        depth,
        parentId: null,
        order: nodes.length,
        content: "",
        _lines: [],
      };

      nodes.push(node);
      nodeMap[node.id] = node;
      current = node;
    } else if (current) {
      current._lines.push(line);
    }
  }

  // Seal last node
  if (current) {
    current.content = cleanContent(current._lines);
    delete current._lines;
  }

  // ---------------------------------------------------------------------------
  // Resolve parent IDs using depth-based ancestor tracking
  // ---------------------------------------------------------------------------
  const ancestors = []; // stack indexed by depth (1-based)

  for (const node of nodes) {
    ancestors[node.depth] = node.id;
    // clear deeper slots so they don't leak across siblings
    for (let d = node.depth + 1; d <= 6; d++) ancestors[d] = undefined;

    const parentDepth = node.depth - 1;
    node.parentId = parentDepth >= 1 ? (ancestors[parentDepth] ?? null) : null;
  }

  return { nodes, nodeMap };
}

// Strip leading/trailing backtick delimiters from multi-line backtick blocks.
// A multi-line backtick block opens when a line STARTS with ` and doesn't
// close on the same line, and ends at a line that is just ` or ends with `.
function cleanContent(lines) {
  const out = [];
  let inBlock = false;

  for (const line of lines) {
    if (!inBlock) {
      // Detect opening: line starts with backtick and either the line is
      // longer than 1 char (opening backtick + content) and the line does NOT
      // end with another backtick that closes it on the same line, OR the
      // line is solely a backtick (unusual but handle it).
      if (line.startsWith("`")) {
        const inner = line.slice(1);
        if (inner.endsWith("`") && inner.length > 0) {
          // Closed on same line — just strip the wrapping backticks
          out.push(inner.slice(0, -1));
        } else {
          // Multi-line block opens
          inBlock = true;
          if (inner.trim()) out.push(inner); // keep first-line content if any
        }
      } else {
        out.push(line);
      }
    } else {
      // Inside a multi-line block
      if (line === "`" || line.endsWith("`")) {
        inBlock = false;
        const inner = line.endsWith("`") ? line.slice(0, -1) : "";
        if (inner.trim()) out.push(inner);
      } else {
        out.push(line);
      }
    }
  }

  return out.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Build lunr index
// ---------------------------------------------------------------------------
function buildIndex(nodes) {
  return lunr(function () {
    this.ref("id");
    this.field("title", { boost: 10 });
    this.field("doc_no", { boost: 5 });
    this.field("type", { boost: 2 });
    this.field("content");

    for (const node of nodes) {
      this.add({
        id: node.id,
        title: node.title,
        doc_no: node.doc_no,
        type: node.type,
        content: node.content,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function printStats(nodes) {
  const byType = {};
  const byDepth = {};
  let emptyContent = 0;

  for (const node of nodes) {
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    byDepth[node.depth] = (byDepth[node.depth] ?? 0) + 1;
    if (!node.content) emptyContent++;
  }

  console.log("\n=== Atlas Parse Stats ===");
  console.log(`Total nodes:   ${nodes.length}`);
  console.log(`Empty content: ${emptyContent}`);
  console.log("\nBy type:");
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1]))
    console.log(`  ${t.padEnd(24)} ${n}`);
  console.log("\nBy depth:");
  for (const [d, n] of Object.entries(byDepth).sort((a, b) => +a[0] - +b[0]))
    console.log(`  depth ${d}: ${n}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const src = fs.readFileSync(ATLAS_PATH, "utf8");
console.log("Parsing Atlas…");
const { nodes } = parse(src);

printStats(nodes);

console.log("\nBuilding lunr index…");
const idx = buildIndex(nodes);

fs.mkdirSync(OUT_DIR, { recursive: true });

// docs.json — strip content for the initial load; full content is only needed
// for the detail view and snippet generation (kept in same file for simplicity
// at this scale — we can split later if needed)
const docs = {};
for (const node of nodes) {
  docs[node.id] = {
    id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    type: node.type,
    depth: node.depth,
    parentId: node.parentId,
    order: node.order,
    content: node.content,
    addresses: extractAddresses(node.content),
  };
}

// Merge per-node annotations into a single global view per address. After
// this, every node that references a given address sees the same label, roles,
// and expectedTokens — picked from the richest per-node extraction.
console.log("\nMerging address annotations across nodes…");
const mergedAddrs = mergeAddressAnnotations(Object.values(docs));
console.log(`  ${Object.keys(mergedAddrs).length} unique addresses merged`);

fs.writeFileSync(path.join(OUT_DIR, "docs.json"), JSON.stringify(docs));
fs.writeFileSync(
  path.join(OUT_DIR, "search-index.json"),
  JSON.stringify(idx)
);

const docsSize = (
  fs.statSync(path.join(OUT_DIR, "docs.json")).size / 1024
).toFixed(1);
const idxSize = (
  fs.statSync(path.join(OUT_DIR, "search-index.json")).size / 1024
).toFixed(1);

console.log(
  `\nWrote public/docs.json (${docsSize} KB) and public/search-index.json (${idxSize} KB)`
);
