/**
 * Atlas layout detection + snapshot loading over GIT TREE-ISHES.
 *
 * Sibling of atlas-source.mjs, which does the same job over a working checkout.
 * build-history walks every commit the atlas ever had, so it meets all three
 * layouts in one run and is the one consumer that must switch reader per commit:
 *
 *   monolithic    pre-#236      a single composed `Sky Atlas/Sky Atlas.md`
 *   atomized      #236 → #294   ~11k `content/<segs>/document.md`
 *   consolidated  #294 →        ~16 composed bucket files in `content/`
 *
 * Every reader returns the same uuid → { doc_no, title, type, content,
 * contentHash, path } map, so diffing is layout-blind. contentHashes agree
 * ACROSS layouts (all three trim the body to the same byte stream), which is what
 * keeps a re-grouping commit from reading as an atlas-wide content rewrite.
 *
 * ⛔ NO READER MAY RETURN AN EMPTY MAP. Downstream, empty means "every document
 * was deleted" — it is written to atlas_history and the cursor advances past it.
 * An unreadable or unrecognised tree throws instead.
 */

import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";

import { HEADING_RE, unquoteYamlName } from "./atlas-parser.mjs";
import { bucketFromFilename, compareBuckets } from "./atlas-source.mjs";

export const ATLAS_FILE = "Sky Atlas/Sky Atlas.md";
export const CONTENT_DIR = "content";

export function makeNodeEntry(doc_no, title, type, content, path) {
  return {
    doc_no,
    title,
    type,
    content,
    path,
    contentHash: crypto.createHash("md5").update(content).digest("hex"),
  };
}

/** Parse composed markdown (the pre-#236 monolith, or one post-#294 bucket file)
 *  into uuid → entry. `srcPath` is the git path every node in `text` lives at:
 *  nodes from one composed file share it, so `prev.path !== curr.path` detects a
 *  layout cutover and any doc move without firing among unmoved siblings. */
export function parseMonolithic(text, srcPath = ATLAS_FILE) {
  const nodes = new Map();
  if (!text) return nodes;

  let cur = null;
  let buf = [];
  const flush = () => {
    if (!cur) return;
    const content = buf.join("\n").trim();
    cur.entry.content = content;
    cur.entry.contentHash = crypto.createHash("md5").update(content).digest("hex");
  };

  for (const line of text.split("\n")) {
    const m = line.match(HEADING_RE);
    if (m) {
      flush();
      const [, , doc_no, title, type, id] = m;
      const entry = { doc_no, title, type, contentHash: "", content: "", path: srcPath };
      nodes.set(id, entry);
      cur = { id, entry };
      buf = [];
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return nodes;
}

/** Strip frontmatter + the markdown heading line from a document.md body.
 *  Returns the trimmed body string used for hashing/diffing.
 *
 *  Equivalence with parseMonolithic: in a composed file, each node's content is
 *  exactly the lines between its heading and the next. In document.md those are
 *  exactly the lines after the leading heading line that sits below the
 *  frontmatter — once both are trimmed, the byte stream is identical, so
 *  contentHashes agree across formats. */
export function extractBody(raw) {
  const lines = raw.split("\n");
  let i = 0;

  // Frontmatter: --- ... ---
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") i++;
    i++; // past closing ---
  }

  // Skip blanks before the heading line
  while (i < lines.length && lines[i].trim() === "") i++;

  // Skip the markdown heading (e.g. "## A.0 - Atlas Preamble [Scope]")
  if (i < lines.length && /^#{1,6} /.test(lines[i])) i++;

  return lines.slice(i).join("\n").trim();
}

/** Parse the document.md frontmatter for the fields we care about.
 *  Frontmatter is a small subset of YAML (`key: value` per line); a hand parser
 *  is fine here and avoids pulling in a YAML dep. Unquoting (both quoting styles
 *  `decompose.py` emits) is shared with atlas-parser.mjs's parseDocumentMd. */
export function parseFrontmatter(raw) {
  const lines = raw.split("\n");
  if (lines[0] !== "---") return null;
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = unquoteYamlName(m[2]);
  }
  return out;
}

/** Bind the readers to one atlas repo. → { git, detectFormat, loadSnapshot, … } */
export function makeAtlasGitSource(repoDir) {
  const git = (args, opts = {}) =>
    execSync(`git ${args}`, {
      cwd: repoDir,
      encoding: "utf8",
      maxBuffer: 100 * 1024 * 1024,
      ...opts,
    }).trim();

  /** `git ls-tree <args>` → [{ sha, path }] for blob entries only. Paths come
   *  back unquoted for the spaces in post-#294 bucket filenames (verified
   *  against the real tree); only non-ASCII/control chars trigger git quoting. */
  const lsTreeBlobs = (args) => {
    const blobs = [];
    for (const line of git(`ls-tree ${args}`).split("\n")) {
      if (!line) continue;
      // Format: <mode> <type> <sha>\t<path>
      const tabIdx = line.indexOf("\t");
      if (tabIdx < 0) continue;
      const meta = line.slice(0, tabIdx).split(/\s+/);
      if (meta[1] !== "blob") continue;
      blobs.push({ sha: meta[2], path: line.slice(tabIdx + 1) });
    }
    return blobs;
  };

  /** Bulk-read blobs in one `git cat-file --batch` → [{ ...blob, raw }], in order. */
  const readBlobs = (blobs) => {
    if (!blobs.length) return [];
    const res = spawnSync("git", ["cat-file", "--batch"], {
      cwd: repoDir,
      input: blobs.map((b) => b.sha).join("\n") + "\n",
      maxBuffer: 500 * 1024 * 1024,
    });
    if (res.status !== 0)
      throw new Error(`git cat-file --batch failed: ${res.stderr?.toString() ?? ""}`);
    const buf = res.stdout;

    const out = [];
    let pos = 0;
    for (const blob of blobs) {
      // Header line: "<sha> <type> <size>\n"
      const nl = buf.indexOf(0x0a, pos);
      if (nl < 0) throw new Error(`malformed cat-file output for ${blob.path}`);
      const header = buf.slice(pos, nl).toString("utf8");
      const parts = header.split(" ");
      if (parts[0] !== blob.sha || parts[1] !== "blob")
        throw new Error(`cat-file header mismatch for ${blob.path}: got ${header}`);
      const size = parseInt(parts[2], 10);
      const start = nl + 1;
      out.push({ ...blob, raw: buf.slice(start, start + size).toString("utf8") });
      pos = start + size + 1; // skip trailing \n after blob
    }
    return out;
  };

  /** Classify a commit's atlas layout.
   *
   *  `content/` alone cannot discriminate — #294 kept the directory and changed
   *  only what is inside it — so this lists the directory's direct children and
   *  looks for bucket filenames. Throws rather than returning a sentinel: every
   *  commit getCommits() enumerates touched one of these paths. */
  const detectFormat = (hash) => {
    let children = [];
    try {
      children = git(`ls-tree --name-only ${hash} "${CONTENT_DIR}/"`).split("\n").filter(Boolean);
    } catch {
      /* no content/ at this commit — fall through to the monolith check */
    }
    if (children.some((p) => bucketFromFilename(path.basename(p)))) return "consolidated";
    if (children.length) return "atomized";

    const top = git(`ls-tree --name-only ${hash} -- "${ATLAS_FILE}"`);
    if (top.split("\n").filter(Boolean).includes(ATLAS_FILE)) return "monolithic";

    throw new Error(
      `commit ${hash} has neither ${CONTENT_DIR}/ nor ${ATLAS_FILE} — unrecognised atlas ` +
        "layout. Refusing to treat it as an empty atlas (that would emit a removal event " +
        "per document).",
    );
  };

  /** Walk content/**\/document.md at a commit (#236..#294 layout). */
  const loadAtomizedAt = (hash) => {
    const blobs = lsTreeBlobs(`-r ${hash} -- "${CONTENT_DIR}"`).filter((b) =>
      b.path.endsWith("/document.md"),
    );
    if (!blobs.length)
      throw new Error(
        `commit ${hash} classified as atomized but has no ${CONTENT_DIR}/**/document.md blobs.`,
      );

    const nodes = new Map();
    for (const blob of readBlobs(blobs)) {
      const fm = parseFrontmatter(blob.raw);
      if (!fm || !fm.id) continue; // not a document.md we recognize
      nodes.set(
        fm.id,
        makeNodeEntry(fm.docNo, fm.name, fm.type, extractBody(blob.raw), blob.path),
      );
    }
    return nodes;
  };

  /** Read the ~16 composed bucket files at a commit (post-#294 layout).
   *
   *  Each file is parsed on its own rather than concatenated: parseMonolithic
   *  trims every body, so per-file parsing yields exactly the contentHashes the
   *  concatenation would — and it lets each node carry the bucket file it
   *  actually lives in, so a document moving between buckets stays a move. */
  const loadConsolidatedAt = (hash) => {
    const bucketOf = (b) => bucketFromFilename(path.basename(b.path));
    const blobs = lsTreeBlobs(`${hash} "${CONTENT_DIR}/"`)
      .filter(bucketOf)
      .sort((a, b) => compareBuckets(bucketOf(a), bucketOf(b)));
    if (!blobs.length)
      throw new Error(
        `commit ${hash} classified as consolidated but has no bucket files under ${CONTENT_DIR}/.`,
      );

    const nodes = new Map();
    for (const blob of readBlobs(blobs)) {
      for (const [id, entry] of parseMonolithic(blob.raw, blob.path)) nodes.set(id, entry);
    }
    return nodes;
  };

  /** Read the legacy monolithic atlas file at a specific commit. */
  const readMonolithicAt = (hash) => {
    try {
      return git(`show ${hash}:"${ATLAS_FILE}"`);
    } catch {
      return null;
    }
  };

  /** Layout-aware snapshot loader: one Map<uuid,…> shape, whichever layout the
   *  commit is in. Never returns empty — see the module header. */
  const loadSnapshot = (hash) => {
    const fmt = detectFormat(hash);
    if (fmt === "atomized") return loadAtomizedAt(hash);
    if (fmt === "consolidated") return loadConsolidatedAt(hash);

    // detectFormat already confirmed the blob exists, so a read failure is real.
    const text = readMonolithicAt(hash);
    if (text === null) throw new Error(`cannot read ${ATLAS_FILE} at ${hash}`);
    return parseMonolithic(text);
  };

  return {
    git,
    detectFormat,
    loadSnapshot,
    loadAtomizedAt,
    loadConsolidatedAt,
    readMonolithicAt,
  };
}
