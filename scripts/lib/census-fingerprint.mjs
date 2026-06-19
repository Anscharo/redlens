/**
 * Structural fingerprinting for the atlas coverage census.
 *
 * A fingerprint groups docs by the structural features that extraction
 * patterns key on (tables, addresses, stereotyped relationship sentences,
 * backtick-bullet params). The census (check-atlas-census.mjs) counts, per
 * fingerprint, how many docs contributed nothing to the graph — a NEW
 * fingerprint cluster with uncovered docs means the atlas started encoding a
 * structure no pattern handles yet.
 *
 * Fingerprints are cluster keys, not extraction logic — a false positive
 * here only changes which bucket a doc lands in, never what gets extracted.
 */

// Stereotyped sentence shapes that usually encode a relationship. Each id
// becomes a feature; SIGNAL_FEATURES below decides which features make an
// uncovered cluster worth warning about.
export const SENTENCE_SHAPES = [
  ["resp-party", /\bThe Responsible Party is\b/i],
  ["role-for-is", /\bThe [A-Z][A-Za-z ]{2,40} for [^.\n]{1,80} (?:is|are)\b/],
  ["party-comprises", /\bThe party ['‘][^'’\n]+['’]\s+(?:comprises|is)\b/i],
  ["role-held-by", /\brole is held by\b/i],
  ["signing-req", /\bsigning requirement\b/i],
  ["addr-of-is", /\bThe address(?:es)? of\b[^.\n]{1,120}\b(?:is|are)\b/i],
  ["modify-signers", /\bcan change the signers\b/i],
  ["serves-as", /\bserves as the\b/i],
  ["transfer", /\b(?:will transfer|has transferred|were transferred|will receive|has received)\b/i],
];

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/;

// A table only counts when it has at least one data row — the atlas is full
// of empty registry stubs (header + separator) that carry no extractable rows.
export function hasDataTable(content) {
  const rows = content.split("\n").filter((l) => TABLE_ROW_RE.test(l));
  if (rows.length < 3) return false;
  return rows.filter((l) => !TABLE_SEP_RE.test(l)).length >= 2;
}

const BULLET_KV_RE = /^\s*[-*]\s+`[^`\n]+`\s*:/m;
const UUID_LINK_RE = /\]\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/;

export function docFeatures(doc) {
  const content = doc.content ?? "";
  const feats = [];
  if (hasDataTable(content)) feats.push("table");
  if ((doc.addressRefs?.length ?? 0) > 0) feats.push("addr");
  if (BULLET_KV_RE.test(content)) feats.push("bullet-kv");
  if (UUID_LINK_RE.test(content)) feats.push("uuid-link");
  for (const [id, re] of SENTENCE_SHAPES) {
    if (re.test(content)) feats.push(`s:${id}`);
  }
  return feats.sort();
}

export function fingerprint(doc) {
  const feats = docFeatures(doc);
  return `${doc.type}|${feats.length ? feats.join(",") : "plain"}`;
}

// Features that make an *uncovered* cluster warn-worthy. Plain prose and
// uuid-link-only docs are expected to contribute nothing beyond cites.
export const SIGNAL_FEATURES = new Set([
  "table",
  "addr",
  "bullet-kv",
  ...SENTENCE_SHAPES.map(([id]) => `s:${id}`),
]);

export function isSignalFingerprint(fp) {
  const feats = fp.split("|")[1] ?? "";
  return feats.split(",").some((f) => SIGNAL_FEATURES.has(f));
}
