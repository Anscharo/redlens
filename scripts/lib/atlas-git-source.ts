/**
 * Atlas layout detection + snapshot loading over GIT TREE-ISHES.
 *
 * Sibling of atlas-source.mjs, which does the same job over a working checkout.
 * A per-commit walk (build-history, build-doc-versions, a preview's commit
 * history) can meet every layout the atlas has shipped, so the reader is chosen
 * per commit:
 *
 *   monolithic    pre-#236      a single composed `Sky Atlas/Sky Atlas.md`   (history-ok: atlas PR)
 *   atomized      #236 → #294   ~11k `content/<segs>/document.md`            (history-ok: atlas PR)
 *   consolidated  #294 →        ~16 composed bucket files in `content/`      (history-ok: atlas PR)
 *
 * Every reader returns the same uuid → entry map (atlas-git-parse.ts), so
 * diffing is layout-blind. Reads go through a GitTreeBackend: the git CLI
 * (atlas-git-cli.ts) or anything else that can list a tree and read blobs.
 *
 * ⛔ NO READER MAY RETURN AN EMPTY MAP. Downstream, empty means "every document
 * was deleted": it is written to atlas_history and the cursor advances past it.
 * An unreadable or unrecognised tree throws instead.
 */

import path from "node:path";

import { gitCliBackend, makeGit } from "./atlas-git-cli.ts";
import { ATLAS_FILE, CONTENT_DIR, extractBody, makeNodeEntry, parseFrontmatter, parseMonolithic, type GitSnapshot } from "./atlas-git-parse.ts";
import { bucketFromFilename, compareBuckets } from "./atlas-source.mjs";

export { ATLAS_FILE, CONTENT_DIR, extractBody, makeNodeEntry, parseFrontmatter, parseMonolithic };
export type { GitSnapshot, GitSnapshotEntry } from "./atlas-git-parse.ts";

export interface GitBlob {
  sha: string;
  path: string;
}
export interface GitBlobText extends GitBlob {
  raw: string;
}
export interface GitTreeEntry extends GitBlob {
  /** "blob", "tree" or "commit" (a submodule). */
  type: string;
}

/** Read access to one repository's trees. `listTree` lists `dir`'s children at
 *  `treeish` (every blob below it when `recursive`) with repo-relative paths, and
 *  an empty list when `dir` does not exist there. `readBlobs` keeps input order. */
export interface GitTreeBackend {
  listTree(treeish: string, dir: string, recursive?: boolean): Promise<GitTreeEntry[]>;
  readBlobs(blobs: GitBlob[]): Promise<GitBlobText[]>;
}

export type AtlasLayout = "monolithic" | "atomized" | "consolidated";

const bucketOf = (p: string): string | null => bucketFromFilename(path.basename(p));

async function monolithBlob(backend: GitTreeBackend, hash: string): Promise<GitTreeEntry | undefined> {
  return (await backend.listTree(hash, path.dirname(ATLAS_FILE))).find((e) => e.path === ATLAS_FILE);
}

/** Classify a commit's layout. `content/` alone cannot discriminate (the
 *  consolidation kept the directory and changed only what is inside it), so this
 *  looks for bucket filenames among its children. Throws on anything else. */
export async function detectFormat(backend: GitTreeBackend, hash: string): Promise<AtlasLayout> {
  const children = await backend.listTree(hash, CONTENT_DIR);
  if (children.some((e) => bucketOf(e.path))) return "consolidated";
  if (children.length) return "atomized";
  if (await monolithBlob(backend, hash)) return "monolithic";
  throw new Error(
    `commit ${hash} has neither ${CONTENT_DIR}/ nor ${ATLAS_FILE} — unrecognised atlas ` +
      "layout. Refusing to treat it as an empty atlas (that would emit a removal event per document).",
  );
}

async function loadAtomized(backend: GitTreeBackend, hash: string): Promise<GitSnapshot> {
  const blobs = (await backend.listTree(hash, CONTENT_DIR, true)).filter(
    (e) => e.type === "blob" && e.path.endsWith("/document.md"),
  );
  if (!blobs.length) throw new Error(`commit ${hash} classified as atomized but has no ${CONTENT_DIR}/**/document.md blobs.`);
  const nodes: GitSnapshot = new Map();
  for (const blob of await backend.readBlobs(blobs)) {
    const fm = parseFrontmatter(blob.raw);
    if (!fm?.id) continue; // not a document.md we recognise
    nodes.set(fm.id, makeNodeEntry(fm.docNo, fm.name, fm.type, extractBody(blob.raw), blob.path));
  }
  return nodes;
}

/** Each bucket file is parsed on its own, not concatenated: bodies are trimmed,
 *  so the contentHashes are the same either way, and each node keeps the bucket
 *  it lives in, so a document moving between buckets stays a move. */
async function loadConsolidated(backend: GitTreeBackend, hash: string): Promise<GitSnapshot> {
  const blobs = (await backend.listTree(hash, CONTENT_DIR))
    .filter((e) => e.type === "blob" && bucketOf(e.path))
    .sort((a, b) => compareBuckets(bucketOf(a.path)!, bucketOf(b.path)!));
  if (!blobs.length) throw new Error(`commit ${hash} classified as consolidated but has no bucket files under ${CONTENT_DIR}/.`);
  const nodes: GitSnapshot = new Map();
  for (const blob of await backend.readBlobs(blobs)) {
    for (const [id, entry] of parseMonolithic(blob.raw, blob.path)) nodes.set(id, entry);
  }
  return nodes;
}

async function loadMonolithic(backend: GitTreeBackend, hash: string): Promise<GitSnapshot> {
  const blob = await monolithBlob(backend, hash);
  if (!blob) throw new Error(`cannot read ${ATLAS_FILE} at ${hash}`);
  const [{ raw }] = await backend.readBlobs([blob]);
  return parseMonolithic(raw.trim());
}

/** One uuid → entry map, whichever layout the commit is in. Never empty. */
export async function loadSnapshot(backend: GitTreeBackend, hash: string): Promise<GitSnapshot> {
  const fmt = await detectFormat(backend, hash);
  if (fmt === "atomized") return loadAtomized(backend, hash);
  if (fmt === "consolidated") return loadConsolidated(backend, hash);
  return loadMonolithic(backend, hash);
}

/** Every commit (oldest first) that touches the monolith or `content/`: the list
 *  every per-commit walk iterates, so they agree on what the atlas's history is.
 *  `ref` defaults to the checked-out HEAD. */
function atlasCommits(git: ReturnType<typeof makeGit>, ref = ""): { hash: string; date: string; message: string }[] {
  const raw = git(`log --reverse --format="%H %aI %s" ${ref} -- "${ATLAS_FILE}" "${CONTENT_DIR}"`);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split(" ");
      return { hash, date, message: rest.join(" ") };
    });
}

/** Bind the readers to one backend. */
export function makeAtlasTreeReader(backend: GitTreeBackend) {
  return {
    detectFormat: (hash: string) => detectFormat(backend, hash),
    loadSnapshot: (hash: string) => loadSnapshot(backend, hash),
  };
}

/** Bind the readers to one local clone, read with the git CLI. */
export function makeAtlasGitSource(repoDir: string) {
  const git = makeGit(repoDir);
  return { git, atlasCommits: (ref = "") => atlasCommits(git, ref), ...makeAtlasTreeReader(gitCliBackend(repoDir)) };
}
