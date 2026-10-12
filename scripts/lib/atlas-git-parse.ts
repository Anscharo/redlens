/**
 * The document parsers behind atlas-git-source.ts: one composed markdown file
 * (`parseMonolithic`) or one `document.md` (`parseFrontmatter` + `extractBody`)
 * → snapshot entries. Pure: no git, no layout decisions. Which files a commit's
 * atlas lives in is atlas-git-source.ts's job alone.
 *
 * contentHashes agree ACROSS layouts: both parsers trim a body to the same byte
 * stream, which keeps a regrouping commit from reading as an atlas-wide rewrite.
 */

import crypto from "node:crypto";

import { HEADING_RE, unquoteYamlName } from "./atlas-parser.mjs";

export const ATLAS_FILE = "Sky Atlas/Sky Atlas.md";
export const CONTENT_DIR = "content";

/** One document at one commit. `path` is the git path it lives at: documents of
 *  one composed file share it, so `prev.path !== curr.path` is a layout cutover
 *  or a real move, never noise among unmoved siblings. */
export interface GitSnapshotEntry {
  doc_no: string;
  title: string;
  type: string;
  content: string;
  contentHash: string;
  path: string;
}

/** uuid → entry, for one commit. */
export type GitSnapshot = Map<string, GitSnapshotEntry>;

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

export function makeNodeEntry(doc_no: string, title: string, type: string, content: string, path: string): GitSnapshotEntry {
  return { doc_no, title, type, content, path, contentHash: md5(content) };
}

function setBody(entry: GitSnapshotEntry, lines: string[]): void {
  entry.content = lines.join("\n").trim();
  entry.contentHash = md5(entry.content);
}

/** Parse composed markdown (the monolith, or one consolidated bucket file) into
 *  uuid → entry. Every node gets `srcPath`, the file `text` was read from. */
export function parseMonolithic(text: string | null | undefined, srcPath: string = ATLAS_FILE): GitSnapshot {
  const nodes: GitSnapshot = new Map();
  if (!text) return nodes;
  let cur: GitSnapshotEntry | null = null;
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(HEADING_RE);
    if (!m) {
      if (cur) buf.push(line);
      continue;
    }
    if (cur) setBody(cur, buf);
    const [, , doc_no, title, type, id] = m;
    cur = { doc_no, title, type, contentHash: "", content: "", path: srcPath };
    nodes.set(id, cur);
    buf = [];
  }
  if (cur) setBody(cur, buf);
  return nodes;
}

/** Strip frontmatter and the markdown heading line from a document.md and trim.
 *
 *  Equivalence with parseMonolithic: in a composed file a node's content is
 *  exactly the lines between its heading and the next; in document.md it is the
 *  lines after the heading below the frontmatter. Trimmed, the bytes match. */
export function extractBody(raw: string): string {
  const lines = raw.split("\n");
  let i = 0;
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") i++;
    i++; // past the closing ---
  }
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#{1,6} /.test(lines[i])) i++;
  return lines.slice(i).join("\n").trim();
}

/** The document.md frontmatter as key → value. It is a `key: value` per line
 *  subset of YAML, so a hand parser does it without a YAML dependency; the
 *  unquoting is shared with atlas-parser.mjs's parseDocumentMd. */
export function parseFrontmatter(raw: string): Record<string, string> | null {
  const lines = raw.split("\n");
  if (lines[0] !== "---") return null;
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = unquoteYamlName(m[2]);
  }
  return out;
}
