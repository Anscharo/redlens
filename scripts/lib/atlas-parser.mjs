/**
 * Atlas markdown parser — shared by build-index and build-history.
 *
 * Two entry points:
 *   parse(src)            — legacy: parse a composed monolith (Sky Atlas.md).
 *                           Still used by build-history for pre-decomposition
 *                           commits and as a fallback in build-index.
 *   parseTree(contentRoot)— direct: parse the decomposed content/**\/document.md
 *                           tree with NO python/compose round-trip. Produces a
 *                           byte-identical { nodes, nodeMap } to parse() over the
 *                           composed output (proven by scripts/aux/ab-parse-check.mjs).
 */

import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";

// sha256 of the raw markdown slice between a heading and the next heading —
// lets anyone with the atlas SHA recompute the hash of a single node
// independently and verify what Sky Atlas by Redline is showing for it.
export function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Heading pattern: `## A.0.1 - Title [Type]  <!-- UUID: <uuid> -->`
// ---------------------------------------------------------------------------
export const HEADING_RE =
  /^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$/;

// Document types defined by ATLAS_MARKDOWN_SYNTAX.md. A heading whose [Type]
// is outside this set means the atlas introduced a convention no extraction
// pattern knows about — warn loudly (stderr feeds the atlas-drift issue) but
// keep the doc; new types must never silently drop content.
export const KNOWN_DOC_TYPES = new Set([
  "Scope",
  "Article",
  "Section",
  "Core",
  "Type Specification",
  "Active Data Controller",
  "Annotation",
  "Action Tenet",
  "Scenario",
  "Scenario Variation",
  "Active Data",
  "Needed Research",
]);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
export function parse(src) {
  const lines = src.split("\n");
  const nodes = []; // ordered list of nodes as we encounter headings
  const nodeMap = {}; // uuid → node

  let current = null; // node currently accumulating content lines

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      // Seal previous node's content. Hash the raw slice first so the hash
      // covers what's actually in Sky Atlas.md, not our cleaned projection.
      if (current) {
        const raw = current._lines.join("\n");
        current.contentHash = sha256(raw);
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
        contentHash: "",
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
    const raw = current._lines.join("\n");
    current.contentHash = sha256(raw);
    current.content = cleanContent(current._lines);
    delete current._lines;
  }

  const unknownTypes = new Map(); // type → { count, first doc_no }
  for (const node of nodes) {
    if (!KNOWN_DOC_TYPES.has(node.type)) {
      const u = unknownTypes.get(node.type) ?? { count: 0, first: node.doc_no };
      u.count++;
      unknownTypes.set(node.type, u);
    }
  }
  for (const [type, u] of unknownTypes) {
    console.warn(
      `[drift] unknown document type "${type}" — ${u.count} doc(s), first at ${u.first}; no extraction pattern handles this type`,
    );
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

// ===========================================================================
// parseTree — direct content/** → nodes, no compose/python round-trip.
//
// Faithful port of sync/compose.py's traversal + heading-level computation,
// but emitting node objects instead of markdown. The compose path built a
// monolith purely so parse() could regex it back apart; the frontmatter
// already carries id/docNo/name/type, so we skip the round-trip entirely.
//
// Equivalence with parse(compose(content)) is guaranteed by construction and
// checked byte-for-byte by scripts/aux/ab-parse-check.mjs. Standing invariant
// checks (below) fail the build loudly on any structural disagreement.
// ===========================================================================

// Inverse of decompose.yaml_quote_name — mirror of compose.py:_unquote_yaml_name.
// Only the double-quoted form is escaped; bare values pass through. Replace
// order (\" then \\) matches compose.py exactly for byte-identical names.
function unquoteYamlName(s) {
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return s;
}

// Parse a YAML inline list `[uuid1, uuid2]` — mirror of compose.py:_parse_targets_value.
function parseTargetsValue(v) {
  v = v.trim();
  if (!(v.startsWith("[") && v.endsWith("]")))
    throw new Error(`expected YAML inline list, got ${JSON.stringify(v)}`);
  const inner = v.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((t) => t.trim()).filter(Boolean);
}

// Parse one document.md — mirror of compose.py:parse_document_md.
// Layout: `---`, frontmatter, `---`, blank line(s), heading line, content lines.
// The heading line is discarded (it uses min(depth+1,6) hashes which we don't
// trust — depth is recomputed structurally); content_lines = everything after it.
function parseDocumentMd(text, folderPath) {
  const where = folderPath.join("/");
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error(`document.md at ${where} does not start with ---`);
  const endFm = lines.indexOf("---", 1);
  if (endFm === -1) throw new Error(`document.md at ${where} has unterminated frontmatter`);

  const fm = {};
  for (const fl of lines.slice(1, endFm)) {
    const ci = fl.indexOf(":");
    if (ci === -1) continue;
    fm[fl.slice(0, ci).trim()] = fl.slice(ci + 1).trim();
  }

  const post = lines.slice(endFm + 1);
  let idx = 0;
  while (idx < post.length && post[idx] === "") idx++;
  const contentLines = idx >= post.length ? [] : post.slice(idx + 1);

  return {
    folderPath,
    uuid: fm.id,
    doc_no: fm.docNo,
    title: unquoteYamlName(fm.name ?? ""),
    type: fm.type,
    targets: fm.targets ? parseTargetsValue(fm.targets) : [],
    contentLines,
  };
}

// Walk contentRoot, parse every document.md. folderPath is content-relative,
// e.g. ['A','0'] for content/A/0/document.md.
function findAllDocuments(contentRoot) {
  const docs = [];
  const walk = (dirAbs, rel) => {
    const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === "document.md")) {
      docs.push(parseDocumentMd(fs.readFileSync(path.join(dirAbs, "document.md"), "utf8"), rel));
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dirAbs, e.name), [...rel, e.name]);
    }
  };
  walk(contentRoot, []);
  return docs;
}

// Structural heading level — mirror of compose.py:compute_heading_levels.
// Non-NR: 1 + (ancestor folders that contain a document.md), capped at 6.
//   Phantom extension folders (only _index.md) don't count.
// NR: target's level + 1, capped at 6 (memoized; recurses through targets[0]).
function computeLevels(docs, contentRoot) {
  const byUuid = new Map(docs.map((d) => [d.uuid, d]));
  const hasDocCache = new Map();
  const hasDocumentMd = (p) => {
    const key = p.join("/");
    if (hasDocCache.has(key)) return hasDocCache.get(key);
    const r = fs.existsSync(path.join(contentRoot, ...p, "document.md"));
    hasDocCache.set(key, r);
    return r;
  };

  const levels = new Map();
  const levelOf = (doc) => {
    if (levels.has(doc.uuid)) return levels.get(doc.uuid);
    let lv;
    if (doc.doc_no.startsWith("NR-")) {
      const target = doc.targets.length ? byUuid.get(doc.targets[0]) : undefined;
      lv = target ? Math.min(levelOf(target) + 1, 6) : 1;
    } else {
      let count = 0;
      for (let i = 1; i < doc.folderPath.length; i++) {
        if (hasDocumentMd(doc.folderPath.slice(0, i))) count++;
      }
      lv = Math.min(count + 1, 6);
    }
    levels.set(doc.uuid, lv);
    return lv;
  };
  for (const d of docs) levelOf(d);
  return levels;
}

// Sibling sort — mirror of compose.py:_child_sort_key. Real-doc integers first,
// then phantom integers, then the rare non-integer (`var1`); ties by name.
function makeChildSortKey(parentFullAbs) {
  return (childName) => {
    const hasDoc = fs.existsSync(path.join(parentFullAbs, childName, "document.md"));
    if (/^\d+$/.test(childName)) return [hasDoc ? 0 : 1, parseInt(childName, 10), childName];
    return [2, 0, childName];
  };
}
function compareKeys(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

export function parseTree(contentRoot) {
  const docs = findAllDocuments(contentRoot);
  const byUuid = new Map(docs.map((d) => [d.uuid, d]));
  const byFolder = new Map(docs.map((d) => [d.folderPath.join("/"), d]));
  const levels = computeLevels(docs, contentRoot);

  // NRs grouped by placement target, sorted by NR number — mirror compose.py.
  const nrByTarget = new Map();
  const orphanNrs = [];
  for (const d of docs) {
    if (!d.doc_no.startsWith("NR-")) continue;
    if (d.targets.length && byUuid.has(d.targets[0])) {
      const arr = nrByTarget.get(d.targets[0]) ?? [];
      arr.push(d);
      nrByTarget.set(d.targets[0], arr);
    } else {
      orphanNrs.push(d);
    }
  }
  const nrNum = (nr) => parseInt(nr.doc_no.split("-")[1], 10);
  for (const arr of nrByTarget.values()) arr.sort((a, b) => nrNum(a) - nrNum(b));
  orphanNrs.sort((a, b) => nrNum(a) - nrNum(b));

  // Emit order: depth-first from content/A, real-doc then its NRs then children.
  const ordered = [];
  const emitted = new Set();
  const emitDoc = (d) => {
    if (emitted.has(d.uuid)) return; // paranoid cycle guard, mirrors compose.py
    emitted.add(d.uuid);
    ordered.push(d);
    for (const nr of nrByTarget.get(d.uuid) ?? []) emitDoc(nr);
  };
  const visitFolder = (folderPath) => {
    const fullAbs = path.join(contentRoot, ...folderPath);
    const d = byFolder.get(folderPath.join("/"));
    if (d && !d.doc_no.startsWith("NR-")) emitDoc(d);
    let children;
    try {
      children = fs.readdirSync(fullAbs, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return;
    }
    const keyOf = makeChildSortKey(fullAbs);
    children.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    for (const c of children) visitFolder([...folderPath, c]);
  };
  visitFolder(["A"]);
  for (const nr of orphanNrs) emitDoc(nr);

  // Build nodes (same shape parse() produces).
  const nodes = [];
  const nodeMap = {};
  ordered.forEach((d, i) => {
    const raw = d.contentLines.join("\n");
    const node = {
      id: d.uuid,
      doc_no: d.doc_no,
      title: d.title,
      type: d.type,
      depth: levels.get(d.uuid),
      parentId: null,
      order: i,
      content: cleanContent(d.contentLines),
      contentHash: sha256(raw),
    };
    nodes.push(node);
    nodeMap[node.id] = node;
  });

  // parentId via the SAME depth-stack as parse() — identical result because the
  // composed monolith is exactly these nodes' headings (at `depth` hashes) in
  // this emit order.
  const ancestors = [];
  for (const node of nodes) {
    ancestors[node.depth] = node.id;
    for (let dd = node.depth + 1; dd <= 6; dd++) ancestors[dd] = undefined;
    const parentDepth = node.depth - 1;
    node.parentId = parentDepth >= 1 ? (ancestors[parentDepth] ?? null) : null;
  }

  checkTreeInvariants(docs, ordered, nodes, nodeMap);
  return { nodes, nodeMap };
}

// Standing invariant checks — cheap, run on every parseTree (main + previews),
// fail loudly. The decomposed tree encodes identity redundantly (frontmatter
// id/docNo AND folder path), so these are mostly free cross-validation.
function checkTreeInvariants(docs, ordered, nodes, nodeMap) {
  const errs = [];

  // 1. Every document emitted exactly once.
  if (ordered.length !== docs.length)
    errs.push(`emitted ${ordered.length} docs but found ${docs.length} document.md files`);
  if (nodes.length !== docs.length)
    errs.push(`node count ${nodes.length} != document.md count ${docs.length}`);

  // 2. UUIDs unique, and frontmatter id present.
  const seen = new Set();
  for (const d of docs) {
    if (!d.uuid) errs.push(`document.md at ${d.folderPath.join("/")} missing frontmatter id`);
    else if (seen.has(d.uuid)) errs.push(`duplicate uuid ${d.uuid} (${d.doc_no})`);
    seen.add(d.uuid);
  }

  // 3. Folder path independently encodes the doc_no (non-NR) — the two
  //    encodings must agree, else the tree is malformed or our walk is wrong.
  for (const d of docs) {
    if (d.doc_no.startsWith("NR-")) continue;
    const fromPath = d.folderPath.join(".");
    // Backtick-delimit the compared values: consumers (preview build-failed UI)
    // detect exactly two backticked tokens and render a char-level diff, so
    // near-invisible defects (a trailing dot) get highlighted.
    if (fromPath !== d.doc_no)
      errs.push(
        `path/docNo mismatch: folder ${d.folderPath.join("/")} expects \`${fromPath}\` but frontmatter docNo is \`${d.doc_no}\``,
      );
  }

  // 4. parentId closure.
  for (const n of nodes) {
    if (n.parentId !== null && !nodeMap[n.parentId])
      errs.push(`dangling parentId ${n.parentId} on ${n.doc_no}`);
  }

  if (errs.length) {
    const shown = errs.slice(0, 20).map((e) => `  - ${e}`).join("\n");
    const more = errs.length > 20 ? `\n  … and ${errs.length - 20} more` : "";
    throw new Error(`parseTree invariant violations (${errs.length}):\n${shown}${more}`);
  }
}

// Convert single-backtick block delimiters (an Atlas authoring quirk) to
// proper markdown code fences so react-markdown renders them correctly.
//
// Same-line:   `code`  → `code`   (kept as inline code — backticks preserved)
// Multi-line:  `code\n...\nmore`  → ```\ncode\n...\nmore\n```
export function cleanContent(lines) {
  const out = [];
  let inBlock = false;
  const blockLines = [];

  for (const line of lines) {
    if (!inBlock) {
      if (line.startsWith("`")) {
        const inner = line.slice(1);
        if (inner.endsWith("`") && inner.length > 0) {
          // Same-line wrapper — preserve as inline code
          out.push("`" + inner.slice(0, -1) + "`");
        } else if (inner.includes("`")) {
          // Closing backtick appears mid-line (e.g. `1`.) — valid inline markdown, pass through
          out.push(line);
        } else {
          // Multi-line block opens
          inBlock = true;
          blockLines.length = 0;
          if (inner.trim()) blockLines.push(inner);
        }
      } else {
        out.push(line);
      }
    } else {
      // Inside a multi-line block
      if (line === "`" || line.endsWith("`")) {
        inBlock = false;
        const inner = line.endsWith("`") ? line.slice(0, -1) : "";
        if (inner.trim()) blockLines.push(inner);
        out.push("```");
        out.push(...blockLines);
        out.push("```");
        blockLines.length = 0;
      } else {
        blockLines.push(line);
      }
    }
  }

  // Unclosed block — flush as code fence rather than silently dropping content
  if (inBlock && blockLines.length > 0) {
    out.push("```");
    out.push(...blockLines);
    out.push("```");
  }

  return out.join("\n").trim();
}
