/**
 * Atlas layout detection + loading — the ONE place that knows the atlas has had
 * more than one on-disk layout. Consumers ask for nodes; they never ask which
 * layout produced them.
 *
 *   monolith      pre-#236      a single composed `Sky Atlas/Sky Atlas.md`
 *   atomized      #236 → #294   ~11k `content/<segs>/document.md` (+ `_index.md`)
 *   consolidated  #294 →        16 composed files directly in `content/`
 *
 * Consolidated files are composed-monolith format (no frontmatter) but their
 * heading levels are FILE-RELATIVE: every bucket opens at `#` — `# A.6.1.1.1 -
 * Spark` — whatever depth its subtree sits at in the whole Atlas (upstream
 * sync/partition.py, "Heading levels"). Concatenating them and parsing as-is
 * therefore made the 11 artifact roots depth-1 orphans (parentId null), which
 * cut 7,917 docs off from A.6 for every ancestor walk on the server — ancestor-
 * scoped chat/MCP search, atlas_get ancestor chains, parent_of edges — while the
 * reader's doc_no-derived tree hid it. `restoreAbsoluteLevels` (a port of
 * upstream's `partition.restore_absolute_levels`) re-derives every level from
 * the doc numbers before parsing, exactly as upstream's own reassembly does.
 * Mirrors sync/atlas_source.py + decompose_multi.reassemble.
 *
 * ⛔ DETECTION IS EXPLICIT AND FAILS LOUD. A walk that finds no documents must
 * never be read as "some other layout" — post-#294 that is also what an empty or
 * truncated checkout produces, and the two are indistinguishable. Guessing here
 * is how a broken checkout becomes a successful build of an empty atlas.
 */

import fs from "node:fs";
import path from "node:path";

import { HEADING_RE, parse, parseTree } from "./atlas-parser.mjs";

export const LAYOUT = {
  MONOLITH: "monolith",
  ATOMIZED: "atomized",
  CONSOLIDATED: "consolidated",
};

/** Detection ambiguity, an unreadable checkout, or an implausibly small parse. */
export class AtlasSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "AtlasSourceError";
  }
}

// Paths relative to the atlas repo root.
export const MONOLITH_REL = "Sky Atlas/Sky Atlas.md";
export const CONTENT_REL = "content";

// The atomized tree is identified by its root scope document, not by a recursive
// "is there any document.md" scan — that is both slow and true of a partially
// written tree. Mirror of atlas_source.detect_layout.
const ATOM_ROOT_REL = ["A", "0", "document.md"];

// Mirror of sync/partition.py:FILENAME_RE — keep in sync with upstream.
const BUCKET_FILE_RE = /^(A(?:\.\d+)*) - .*\.md$/;

/** Recover a bucket's doc number from its filename, or null if not a bucket file. */
export function bucketFromFilename(name) {
  const m = BUCKET_FILE_RE.exec(name);
  return m ? m[1] : null;
}

/** Sort key placing buckets in composed-Atlas order. Mirror of partition.order_key.
 *
 *  ⛔ DO NOT SUBSTITUTE FILENAME SORTING. It agrees today and diverges the moment
 *  a tenth Star is added: lexicographically `A.6.1.1.10` sorts between
 *  `A.6.1.1.1` and `A.6.1.1.2`, silently reordering ~2,000 documents. */
export function bucketOrderKey(bucket) {
  return bucket.split(".").slice(1).map((s) => Number.parseInt(s, 10));
}

/** Segment-wise compare over `bucketOrderKey`; a prefix sorts before its extensions. */
export function compareBuckets(a, b) {
  const ka = bucketOrderKey(a);
  const kb = bucketOrderKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    // -1 for a missing segment: `A.6` sorts before `A.6.1`, as Python tuples do.
    const x = ka[i] ?? -1;
    const y = kb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Bucket files in reassembly order: [{ bucket, file }, …]. Duplicate bucket → throw. */
export function listBuckets(contentRoot) {
  const byBucket = new Map();
  for (const e of fs.readdirSync(contentRoot, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const bucket = bucketFromFilename(e.name);
    if (!bucket) continue;
    if (byBucket.has(bucket))
      throw new AtlasSourceError(
        `two files claim bucket ${bucket}: ${byBucket.get(bucket)} and ${e.name}`,
      );
    byBucket.set(bucket, e.name);
  }
  return [...byBucket.keys()]
    .sort(compareBuckets)
    .map((bucket) => ({ bucket, file: byBucket.get(bucket) }));
}

/** Rebuild the composed markdown from the split files. Mirror of decompose_multi.reassemble.
 *
 *  Reassembly orders DOCUMENTS, not buckets (upstream partition.order_documents).
 *  Bucket contiguity is not something the Atlas provides: `A.6.1.2 - List Of
 *  Executor Agent Artifacts` lives in the `A.6` file yet is emitted AFTER every
 *  Prime Agent file, so the `A.6` bucket is two runs — and a third `List Of …`
 *  Section would make it three. Concatenating whole files put A.6.1.2 before
 *  Spark and, once levels were restored, made the depth stack hang every Prime
 *  off A.6.1.2 (the last depth-3 heading seen) instead of A.6.1.1. */
export function readConsolidated(contentRoot) {
  const buckets = listBuckets(contentRoot);
  if (!buckets.length)
    throw new AtlasSourceError(`no Atlas bucket files in ${contentRoot}`);
  const linesBySource = new Map();
  for (const b of buckets) linesBySource.set(b.file, fs.readFileSync(path.join(contentRoot, b.file), "utf8").split("\n"));
  return restoreAbsoluteLevels(orderDocuments(linesBySource).join("\n"));
}

// ---------------------------------------------------------------------------
// Document order — port of sync/partition.py (split_into_blocks /
// canonical_sort_key / order_documents / _assert_source_order_preserved).
// ---------------------------------------------------------------------------

const isNr = (docNo) => docNo.startsWith("NR-");

/** Cut one file's lines into blocks at numbered-document headings. A Needed
 *  Research doc has no position of its own (flat `NR-<n>` namespace; its target
 *  is "the numbered document it follows"), so it travels inside the preceding
 *  block and is never sorted as a document. Mirror of split_into_blocks. */
export function splitIntoBlocks(source, lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m) heads.push([i, m[2]]);
  }
  if (!heads.length) throw new AtlasSourceError(`${source} contains no Atlas document headings`);
  if (heads[0][0] !== 0)
    throw new AtlasSourceError(
      `${source} has ${heads[0][0]} line(s) before its first document heading — that text belongs to no document and would be dropped at reassembly`,
    );
  if (isNr(heads[0][1]))
    throw new AtlasSourceError(`${source} begins with Needed Research ${heads[0][1]}, which has no numbered document in this file to travel with`);
  const starts = heads.filter(([, dn]) => !isNr(dn));
  return starts.map(([start, docNo], k) => ({
    docNo,
    source,
    index: k,
    lines: lines.slice(start, k + 1 < starts.length ? starts[k + 1][0] : lines.length),
  }));
}

/** Compose's emit position for a numbered document, from its doc number alone.
 *  Per segment: (rank, value, text) with rank 0 = real child (some document
 *  claims the prefix), 1 = phantom extension folder (`0` segments no document
 *  claims — compose emits a parent's real children BEFORE any phantom-rooted
 *  subtree, which naive numeric order gets backwards in ~410 places), 2 = the
 *  non-integer `var1` Scenario Variation segment. A parent's key is a prefix of
 *  its children's, so it sorts first for free. Mirror of canonical_sort_key. */
export function canonicalSortKey(docNo, realDocNos) {
  const parts = docNo.split(".");
  const key = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (/^\d+$/.test(seg)) key.push([realDocNos.has(parts.slice(0, i + 1).join(".")) ? 0 : 1, Number.parseInt(seg, 10), ""]);
    else key.push([2, 0, seg]);
  }
  return key;
}

function compareKeys(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++) {
      const x = a[i][j];
      const y = b[i][j];
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return a.length - b.length; // a shorter tuple (the parent) compares less
}

/** Merge split files into the composed line stream, ordered by document. Depends
 *  on neither file order, names, count, nor any manifest. Mirror of order_documents. */
export function orderDocuments(linesBySource) {
  const blocks = [];
  for (const source of [...linesBySource.keys()].sort()) blocks.push(...splitIntoBlocks(source, linesBySource.get(source)));
  const origin = new Map();
  for (const b of blocks) {
    if (origin.has(b.docNo))
      throw new AtlasSourceError(`document ${b.docNo} appears in both ${origin.get(b.docNo)} and ${b.source} — a document must live in exactly one file`);
    origin.set(b.docNo, b.source);
  }
  const real = new Set(origin.keys());
  const keyed = blocks.map((b) => ({ b, k: canonicalSortKey(b.docNo, real) }));
  keyed.sort((x, y) => compareKeys(x.k, y.k));
  const ordered = keyed.map((x) => x.b);
  // Within a file the order is compose's own emit order and is authoritative; the
  // derived key may interleave files but must never move a document backwards past
  // another from the same file — any disagreement with compose fails here, loudly.
  const last = new Map();
  for (const b of ordered) {
    const prev = last.get(b.source) ?? -1;
    if (b.index <= prev)
      throw new AtlasSourceError(
        `document ordering moved ${b.docNo} backwards within ${b.source} (position ${b.index} after ${prev}) — canonicalSortKey and upstream compose disagree`,
      );
    last.set(b.source, b.index);
  }
  return ordered.flatMap((b) => b.lines);
}

// ---------------------------------------------------------------------------
// Heading levels — port of sync/partition.py (structural_depth /
// restore_absolute_levels). Bucket files store levels relative to their own root
// document; the composed Atlas's absolute level is `min(structural_depth + 1, 6)`
// and is RE-DERIVED from doc numbers, never adjusted from the stored hashes: the
// hash count is lossy (10k+ docs sit at the cap), so subtracting a root level
// would flatten every capped document onto the wrong level.
// ---------------------------------------------------------------------------
export const MAX_HEADING_LEVEL = 6;

/** How many documents sit above `docNo`. Segment count is NOT depth: `0`
 *  extension segments (`A.1.4.5.0.4`) and the leading `A` are phantoms no
 *  document claims. An ancestor counts precisely when some document claims that
 *  prefix — the same real/phantom test upstream's canonical_sort_key applies. */
export function structuralDepth(docNo, realDocNos) {
  const parts = docNo.split(".");
  let n = 0;
  for (let i = 1; i < parts.length; i++) if (realDocNos.has(parts.slice(0, i).join("."))) n++;
  return n;
}

/** Give every heading in a reassembled stream its level in the composed Atlas.
 *  Needed Research has no position of its own and takes the level of the
 *  numbered document it follows, plus one, under the same cap (matches compose).
 *  Only heading lines change; node content (and therefore contentHash) is
 *  byte-identical before and after. */
export function restoreAbsoluteLevels(text) {
  const lines = text.split("\n");
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m) heads.push([i, m[2]]);
  }
  const real = new Set(heads.map(([, dn]) => dn).filter((dn) => !dn.startsWith("NR-")));
  let previous = 0;
  for (const [i, dn] of heads) {
    let level;
    if (dn.startsWith("NR-")) {
      level = Math.min(previous + 1, MAX_HEADING_LEVEL);
    } else {
      level = Math.min(structuralDepth(dn, real) + 1, MAX_HEADING_LEVEL);
      previous = level;
    }
    lines[i] = lines[i].replace(/^#+/, "#".repeat(level));
  }
  return lines.join("\n");
}

/** Classify an atlas checkout. Throws on ambiguity, emptiness, or an unreadable tree. */
export function detectLayout(atlasSrcDir) {
  const contentRoot = path.join(atlasSrcDir, CONTENT_REL);

  if (fs.existsSync(contentRoot)) {
    let buckets;
    try {
      buckets = listBuckets(contentRoot);
    } catch (e) {
      if (e instanceof AtlasSourceError) throw e;
      throw new AtlasSourceError(`cannot read ${contentRoot}: ${e.message}`);
    }
    const hasAtomRoot = fs.existsSync(path.join(contentRoot, ...ATOM_ROOT_REL));

    if (buckets.length && hasAtomRoot)
      throw new AtlasSourceError(
        `${contentRoot} contains BOTH consolidated bucket files (${buckets.length}) and an ` +
          "atomized content tree. That is a half-finished migration — refusing to guess.",
      );
    if (buckets.length) return LAYOUT.CONSOLIDATED;
    if (hasAtomRoot) return LAYOUT.ATOMIZED;

    throw new AtlasSourceError(
      `${contentRoot} matches neither layout: no \`A.<n> - <name>.md\` bucket files and no ` +
        "A/0/document.md. An empty or truncated checkout reaches here and must NOT be " +
        "treated as a pre-cutover ref.",
    );
  }

  if (fs.existsSync(path.join(atlasSrcDir, MONOLITH_REL))) return LAYOUT.MONOLITH;

  throw new AtlasSourceError(
    `${atlasSrcDir} has no content/ and no ${MONOLITH_REL} — the atlas submodule is not ` +
      "populated (run `pnpm pull-atlas`) or the checkout is truncated.",
  );
}

// Floor below which a parse is treated as a broken checkout rather than a small
// atlas. The real atlas is ~11k nodes; nothing legitimate lands under this.
export const MIN_NODES_DEFAULT = 1000;

/** Detect, parse, and refuse to return an implausibly small atlas.
 *  → { layout, nodes, nodeMap } */
export function loadAtlasSource(atlasSrcDir, opts = {}) {
  const layout = detectLayout(atlasSrcDir);
  const contentRoot = path.join(atlasSrcDir, CONTENT_REL);

  const parsed =
    layout === LAYOUT.CONSOLIDATED
      ? parse(readConsolidated(contentRoot))
      : layout === LAYOUT.ATOMIZED
        ? parseTree(contentRoot)
        : parse(fs.readFileSync(path.join(atlasSrcDir, MONOLITH_REL), "utf8"));

  const envFloor = Number.parseInt(process.env.ATLAS_MIN_NODES ?? "", 10);
  const min =
    opts.minNodes ?? (Number.isFinite(envFloor) ? envFloor : MIN_NODES_DEFAULT);
  if (parsed.nodes.length < min)
    throw new AtlasSourceError(
      `parsed only ${parsed.nodes.length} nodes from the ${layout} layout at ${atlasSrcDir} ` +
        `(floor ${min}). Refusing to publish an empty atlas — the checkout is truncated or ` +
        "the layout changed again. Set ATLAS_MIN_NODES to override.",
    );

  return { layout, ...parsed };
}
