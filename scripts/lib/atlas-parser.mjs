/**
 * Atlas markdown parser — shared by build-index and build-history.
 */

import crypto from "crypto";

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
