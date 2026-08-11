/**
 * Atlas layout detection + loading — the ONE place that knows the atlas has had
 * more than one on-disk layout. Consumers ask for nodes; they never ask which
 * layout produced them.
 *
 *   monolith      pre-#236      a single composed `Sky Atlas/Sky Atlas.md`
 *   atomized      #236 → #294   ~11k `content/<segs>/document.md` (+ `_index.md`)
 *   consolidated  #294 →        16 composed files directly in `content/`
 *
 * Consolidated files are composed-monolith format (no frontmatter, headings at
 * their absolute composed depth), so `parse()` reads them as-is once they are
 * concatenated in the upstream order. Mirrors sync/atlas_source.py.
 *
 * ⛔ DETECTION IS EXPLICIT AND FAILS LOUD. A walk that finds no documents must
 * never be read as "some other layout" — post-#294 that is also what an empty or
 * truncated checkout produces, and the two are indistinguishable. Guessing here
 * is how a broken checkout becomes a successful build of an empty atlas.
 */

import fs from "node:fs";
import path from "node:path";

import { parse, parseTree } from "./atlas-parser.mjs";

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
 *  Every bucket is contiguous in emit order, so bucket ORDER is the only thing
 *  reassembly needs — there is no manifest upstream and none is wanted here. */
export function readConsolidated(contentRoot) {
  const buckets = listBuckets(contentRoot);
  if (!buckets.length)
    throw new AtlasSourceError(`no Atlas bucket files in ${contentRoot}`);
  // join("\n") — not per-file parsing. `parse()` runs a node's raw slice to the
  // next heading, so parsing each file separately would end the last node of each
  // bucket at EOF and change 16 contentHashes vs the composed monolith.
  return buckets
    .map((b) => fs.readFileSync(path.join(contentRoot, b.file), "utf8"))
    .join("\n");
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
