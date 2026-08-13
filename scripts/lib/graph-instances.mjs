/**
 * ICD / primitive instance parameter extraction.
 */

import {
  ETH_ADDR_EXACT_RE,
  ETH_ADDR_FIRST_RE,
  SOL_ADDR_EXACT_RE,
} from "./address-chains.mjs";

const CURRENT_PRIMITIVES_UUID = "203b8c79-c7cf-4fcc-94e3-5bf42f791619";

/**
 * Parse the "Current Primitives" doc content to build the authoritative set of
 * known primitive titles. Indented list items are primitives; top-level items
 * are category headings and are excluded from the set.
 */
export function buildKnownPrimitives(docById) {
  const doc = docById.get(CURRENT_PRIMITIVES_UUID);
  const known = new Set();
  if (!doc?.content) return known;
  for (const line of doc.content.split("\n")) {
    const m = line.match(/^(\s+)-\s+(.+)$/);
    if (m) known.add(m[2].trim());
  }
  return known;
}

/** Derive a stable slug from a primitive title by stripping the "Primitive" suffix. */
export function primitiveSlugFromTitle(title) {
  return title
    .replace(/\s+Primitive$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function primitiveDisplayName(title) {
  return title.replace(/\s+Primitive$/i, "").trim();
}

export function deriveInstanceName(icd, primRoot, agentDoc, params = {}) {
  const rawName = icd.title.replace(/\s+Instance Configuration Document\s*$/i, "").trim();
  const primitiveName = primitiveDisplayName(primRoot.title);
  const instanceOfMatch = rawName === "Single"
    ? primRoot.content?.match(/for (.+?)\.\s+See/i)
    : null;
  const baseName = instanceOfMatch
    ? instanceOfMatch[1].replace(/\binstance(?:s)?\b/g, "Instance")
    : rawName;

  const genericNames = new Set([
    "Single",
    primRoot.title,
    primitiveName,
  ]);
  const isGeneric =
    genericNames.has(baseName) ||
    baseName.toLowerCase() === primRoot.title.toLowerCase() ||
    baseName.toLowerCase() === primitiveName.toLowerCase();

  if (!isGeneric || !agentDoc?.title) return baseName;

  const partner = params["Integration Partner Name"]?.[0];
  return [agentDoc.title, primitiveName, partner].filter(Boolean).join(" — ");
}

/**
 * Read a primitive's Global Activation Status. Per the atlas convention,
 * `${primRoot}.1.1` is the Primitive Hub Document → Global Activation Status
 * leaf, whose content is a single backtick-wrapped token: `Active`, `Inactive`,
 * or `Completed`. Returns the literal token, or null if unreadable.
 */
export function primitiveStatusFor(primRoot, docByDocNo) {
  const statusDoc = docByDocNo.get(`${primRoot.doc_no}.1.1`);
  if (!statusDoc?.content) return null;
  const m = statusDoc.content.match(/`?(Active|Inactive|Completed)`?/i);
  if (!m) return null;
  return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
}

// Classify an ICD as Instance (Active/Suspended/Completed) or Invocation
// (InProgress). Per atlas A.2.2.1.3 / A.2.2.1.4 these are distinct: an
// Invocation is the in-progress act of enabling a Primitive; an Instance is the
// resulting operational deployment. Tier docs sit at variable depth under
// primRoot (flat .2/.3 layouts vs nested .1.5.1.2 Suspended), so walk up the
// ancestor chain until we find a recognized title.
export function classifyIcd(icd, primRoot, docByDocNo) {
  let cur = icd;
  while (cur && cur.doc_no.startsWith(`${primRoot.doc_no}.`)) {
    const title = cur.title.toLowerCase();
    if (title.startsWith("active instances")) return { kind: "instance", status: "Active" };
    if (title.startsWith("completed instances")) return { kind: "instance", status: "Completed" };
    if (title.startsWith("suspended instances")) return { kind: "instance", status: "Suspended" };
    if (title.startsWith("in progress invocations")) return { kind: "invocation", status: "InProgress" };
    const lastDot = cur.doc_no.lastIndexOf(".");
    if (lastDot < 0) break;
    cur = docByDocNo.get(cur.doc_no.slice(0, lastDot));
  }
  return { kind: null, status: null };
}

// Index of direct children by parent doc_no (doc_no-based; parentId is unreliable past depth 6).
export function buildChildrenIndex(allDocs) {
  const childrenByDocNo = new Map();
  for (const d of allDocs) {
    const lastDot = d.doc_no.lastIndexOf(".");
    if (lastDot < 0) continue;
    const parentDocNo = d.doc_no.slice(0, lastDot);
    if (!childrenByDocNo.has(parentDocNo)) childrenByDocNo.set(parentDocNo, []);
    childrenByDocNo.get(parentDocNo).push(d);
  }
  return childrenByDocNo;
}

// Atlas "directory" placeholder content is a convention — a doc whose content
// is just "The documents herein (define|contain|organize|govern)…" and whose
// real data lives in children. Those are NOT leaves.
const DIRECTORY_RE =
  /^The documents? herein (define|contain|organize|govern|specify|describe|set|compose|hold)\b/i;

// Value formatters — normalize raw content into a displayable value. Keyed by
// leaf title. Each takes the raw trimmed content and returns a cleaned string.
// Fallback is backtick-unwrap + trim.
const unwrapBt = (s) => s.match(/^`([^`\n]+)`\.?$/)?.[1] ?? s;
// Both patterns come from address-chains, the canonical home: the backtick
// branch tests the whole literal, and the fallback carries the hex-boundary
// lookarounds so a 64-hex transaction hash (the atlas writes those in the same
// backtick style) can no longer yield its leading 40 hex as an "address".
// Preserve the formatter's historical 32–44 base58 acceptance separately:
// these isolated ICD values are passed through, not classified as canonical
// Solana addresses (whose shared pattern correctly remains 43–44 chars).
const LEGACY_ICD_BASE58_EXACT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const firstBtOrAddr = (s) => {
  const bt = s.match(/`([^`\n]+)`/)?.[1];
  if (
    bt &&
    (ETH_ADDR_EXACT_RE.test(bt) ||
      SOL_ADDR_EXACT_RE.test(bt) ||
      LEGACY_ICD_BASE58_EXACT_RE.test(bt))
  ) return bt;
  return s.match(ETH_ADDR_FIRST_RE)?.[0] ?? s;
};
const stripSentence =
  (prefixRe, suffixRe = null) =>
  (s) => {
    let v = s.replace(prefixRe, "");
    if (suffixRe) v = v.replace(suffixRe, "");
    return v.replace(/\.$/, "").trim();
  };
// Extracts the 64-char hex hash from backticks, or preserves N/A variants.
const RATE_LIMIT_ID_RE = /^(Inflow|Outflow|Swap) Rate ?Limit ?ID/i;
const extractRateLimitId = (s) => {
  const hash = s.match(/`(0x[0-9a-fA-F]{64})`/)?.[1];
  if (hash) return hash;
  const na = s.match(/:\s*(N\/A[^.]*)/i)?.[1]?.trim();
  return na ?? unwrapBt(s);
};

const PARAM_FORMATTERS = {
  "Name": stripSentence(/^The name of [^.]*? is /i),
  "Agent Type": stripSentence(/^\S+ is an? /i),
  "Reward Code": unwrapBt,
  "Integration Partner Name": stripSentence(/^The partner for the [^.]*? is /i),
  "Integration Partner Reward Address": firstBtOrAddr,
  "Integration Partner Chain": stripSentence(/^The [^.]*? is on (the )?/i, /\s*blockchain\.?$/i),
  "Integration Boost Cadence": stripSentence(/^The payment cadence for the [^.]*? is /i),
  "Token Name": stripSentence(/^The name of [^.]*? is /i),
  "Token Symbol": stripSentence(/^The symbol of [^.]*? is /i),
  "Genesis Supply": stripSentence(/^The Genesis Supply of [^.]*? is /i),
  "Token Address": firstBtOrAddr,
  "Underlying Asset Address": firstBtOrAddr,
  "Allocator Role Address": firstBtOrAddr,
  "Pool Address": firstBtOrAddr,
  Address: firstBtOrAddr,
  Network: (s) => s.replace(/\.$/, "").trim(),
  "Target Protocol": (s) => s.replace(/\.$/, "").trim(),
  Token: (s) => s.replace(/\.$/, "").trim(),
  "Asset Supplied By Spark Liquidity Layer": (s) => s.replace(/\.$/, "").trim(),
};
function formatParam(title, raw) {
  const fn = PARAM_FORMATTERS[title];
  if (fn) return fn(raw.trim());
  if (RATE_LIMIT_ID_RE.test(title)) return extractRateLimitId(raw.trim());
  return unwrapBt(raw.trim());
}

// Expanders turn a compound prose leaf into multiple keyed params sharing the
// same source doc. Used when a single leaf embeds per-chain or per-variant
// values (e.g. Agent Token's "Token Address" stuffs every deployed chain
// address into one blob). Returns Array<[key, value]> or null to fall through.
const PARAM_EXPANDERS = {
  // "The address of X's SubProxy/Genesis Account on (the) Network is `0xADDR`."
  // → "SubProxy Account / Network": "0xADDR"
  "SubProxy Account": (content) => {
    const m = content.match(/on (?:the )?(.+?) is `(0x[0-9a-fA-F]+)`/i);
    return m ? [[`SubProxy Account / ${m[1].trim()}`, m[2]]] : null;
  },
  "Genesis Account": (content) => {
    if (/will be specified/i.test(content)) return [["Genesis Account", "TBD"]];
    const m = content.match(/on (?:the )?(.+?) is `(0x[0-9a-fA-F]+)`/i);
    return m ? [[`Genesis Account / ${m[1].trim()}`, m[2]]] : null;
  },
  "Token Address": (content) => {
    // "The address of X on (the) CHAIN is `ADDR`." — repeats per chain.
    const re = /The address of \S+ on (?:the )?([^.]+?) is `([^`\n]+)`/gi;
    const out = [];
    for (const m of content.matchAll(re)) {
      const chain = m[1].trim().replace(/\s+blockchain$/i, "");
      out.push([`Token Address (${chain})`, m[2]]);
    }
    return out.length ? out : null;
  },
};

// Generic bullet-list expansion. Matches the atlas convention used for rate
// limits and similar parameter groupings:
//   "The {variant} are:\n\n- `key`: value\n- `key`: value"
// Keys are prefixed with the leaf title so sibling groups stay distinct
// ("Inflow Rate Limits / maxAmount" vs "Outflow Rate Limits / maxAmount").
const BULLET_KV_RE = /^\s*[-*]\s+`([^`\n]+)`\s*:\s*(.+?)\s*$/gm;
function expandBulletList(content, outerTitle) {
  const out = [];
  for (const m of content.matchAll(BULLET_KV_RE)) {
    out.push([`${outerTitle} / ${m[1].trim()}`, m[2].trim()]);
  }
  return out.length ? out : null;
}

// Walk down from the Parameters doc under an ICD and flatten leaves into
// { key: [formattedValue, srcUuid, srcDocNo] }. Handles both flat (DR/IB/
// agent-token) and nested (Allocation System: Parameters → Instance Identifiers
// → Network) variants. Key = leaf title. On title collision, prefix with
// "{parentTitle} / " to disambiguate.
export function extractInstanceParams(icd, childrenByDocNo) {
  const direct = childrenByDocNo.get(icd.doc_no) ?? [];
  const paramsDoc = direct.find((c) => c.title === "Parameters");
  if (!paramsDoc) return {};
  const params = {};
  const pending = [{ doc: paramsDoc, parents: [] }];
  while (pending.length) {
    const { doc, parents } = pending.shift();
    const kids = childrenByDocNo.get(doc.doc_no) ?? [];
    const content = (doc.content ?? "").trim();
    const isLeaf = kids.length === 0;
    if (isLeaf) {
      if (!content || DIRECTORY_RE.test(content)) continue;
      // Expansion order: per-title expander → generic bullet-list → formatter.
      const expanded =
        PARAM_EXPANDERS[doc.title]?.(content) ?? expandBulletList(content, doc.title);
      if (expanded) {
        for (const [key, value] of expanded) {
          const finalKey =
            key in params ? `${parents[parents.length - 1] ?? ""} / ${key}`.trim() : key;
          params[finalKey] = [value, doc.id, doc.doc_no];
        }
      } else {
        const baseKey = doc.title;
        const key =
          baseKey in params ? `${parents[parents.length - 1] ?? ""} / ${baseKey}`.trim() : baseKey;
        params[key] = [formatParam(doc.title, content), doc.id, doc.doc_no];
      }
    } else {
      // Skip the "Custom Instance Parameters" subtree at any depth — it's a
      // reserved extension slot, almost always empty/placeholder in practice.
      if (/^custom instance parameters$/i.test(doc.title)) continue;
      for (const c of kids) pending.push({ doc: c, parents: [...parents, doc.title] });
    }
  }
  return params;
}
