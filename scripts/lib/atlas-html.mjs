// HTML-era atlas reader + deterministic HTML→markdown converter (plan §3).
//
// The single repo-structure-dependent module for the pre-#117 (HTML) era. Mirrors
// the contract of parseMonolithic / loadAtomizedAt in build-history.mjs: given a
// commit's HTML, return document nodes keyed by POSITIONAL identity (no UUID
// exists pre-#117, and doc_no is unreliable — see plan §2c). Each node carries
// { section, dfn, doc_no?, title, type, ancestors, content, contentHash,
//   structuralKey, order }.
//
// Determinism is the bar, not fidelity (plan §1): every HTML-era diff compares
// converted-md(N) vs converted-md(N-1) through THIS same converter, so conversion
// artifacts cancel in the line diff. Pin every turndown option.

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import TurndownService from "turndown";
import turndownGfm from "turndown-plugin-gfm";

const HTML_PATH = "Sky Atlas/Sky Atlas.html";

// ---- deterministic cell HTML → markdown -------------------------------------
const td = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
  br: "  ",
});
td.use(turndownGfm.gfm); // GFM tables + strikethrough for nested content tables

// Some HTML-era cells encode lists NOT as <ul>/<li> but as inline bullet CHARACTERS run together in
// one text node — "intro:• item one• item two ◦ sub-item• item three" (• = level 1, ◦ = level 2; no
// <br>, no <li>). Turndown has no list structure to work with, so it emits one wall-of-text line and
// the list — and its nesting — is lost in the content AND in every diff. 106 cells in the last HTML do
// this (792 •, 274 ◦). Recover the intended list from the bullet chars: split a bulleted line into
// items, map • → top level and ◦ → one nesting level, and emit turndown's OWN list shape ("-   " /
// "    -   ") so a doc later reformatted from inline bullets to a real <ul> diffs as a NO-OP (byte-
// identical markdown), and a doc that keeps inline bullets threads/renders as a proper list.
const BULLET_RE = /[•◦]/;
export function recoverInlineBullets(md) {
  if (!BULLET_RE.test(md)) return md;
  return md
    .split("\n")
    .map((line) => {
      const first = line.search(BULLET_RE);
      if (first < 0) return line;
      const lead = line.slice(0, first).trim();
      const items = [];
      for (const m of line.slice(first).matchAll(/([•◦])[ \t]*([^•◦]*)/g)) {
        const text = m[2].trim();
        if (text) items.push(`${m[1] === "◦" ? "    " : ""}-   ${text}`);
      }
      if (!items.length) return line;
      return (lead ? `${lead}\n\n` : "") + items.join("\n");
    })
    .join("\n");
}

/** Convert one content-cell's inner HTML to markdown. Deterministic + trimmed. */
export function htmlCellToMarkdown(innerHtml) {
  if (!innerHtml || !innerHtml.trim()) return "";
  const md = td.turndown(innerHtml).replace(/[ \t]+$/gm, ""); // no trailing whitespace (diff noise)
  return recoverInlineBullets(md)
    .replace(/\n{3,}/g, "\n\n") // collapse blank runs
    .trim();
}

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const textOf = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const DOCNO = /^(?:[A-Z]\.[\w.]+|NR-\d+)$/; // strict-ish doc number

// Per-section: index of the prose-bearing cell(s). Col 0 = dfn (identifier /
// doc-name), col 1 = name / agent (owner), col 2 = type, the rest = prose. Type
// Specs spread prose across cols 3–7; Scenarios across 3–5 (plan §2b).
const PROSE_FROM = { default: 3 };

// ---- parse one HTML blob into document nodes --------------------------------
export function parseHtmlToNodes(html) {
  // section boundaries (11 invariant <h1>s, plan §2.1)
  const secs = [...html.matchAll(/<h1>(.*?)<\/h1>/g)].map((m) => ({ name: m[1].trim(), at: m.index }));
  const sectionAt = (idx) => { let s = "?"; for (const x of secs) { if (x.at < idx) s = x.name; else break; } return s; };

  // document rows: a <tr> whose first cell is a <dfn>. Row body runs to the next
  // such start (absorbing any rare nested content tables — only ~12 era-wide).
  const START = /<tr>\s*<td>\s*<dfn>([\s\S]*?)<\/dfn>\s*<\/td>/g;
  const starts = [...html.matchAll(START)];
  const nodes = [];
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const begin = m.index;
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const rowHtml = html.slice(begin + m[0].length, end); // cells AFTER the dfn cell
    const section = sectionAt(begin);
    const dfn = textOf(m[1]);

    // remaining cells (Name/Agent, Type, prose…) — keep inner HTML for prose
    const cells = [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>(?=\s*(?:<td>|<\/tr>))/g)].map((c) => c[1]);
    const name = textOf(cells[0] || "");
    const type = textOf(cells[1] || "");
    const proseCells = cells.slice(PROSE_FROM.default - 1); // cells[2..] are prose (Name/Type consumed)

    // doc_no + ancestor path from the dfn breadcrumb ("A.0.1 - Parent - … - Leaf")
    const segs = dfn.split(" - ").map((s) => s.trim()).filter(Boolean);
    let doc_no = null, pathSegs = segs;
    if (segs.length && DOCNO.test(segs[0])) { doc_no = segs[0]; pathSegs = segs.slice(1); }

    // Title/owner/ancestors are SECTION-AWARE (plan §2b column schemas):
    //  - breadcrumb dfn  → title = leaf, ancestors = the path (well-structured).
    //  - Agent Scope DB  → dfn IS the doc-name (title); Name cell is the Agent
    //    (owner) — NOT the title.
    //  - everything else → Name cell is the title; owner is the breadcrumb parent.
    const isAgentDb = /agent scope database/i.test(section);
    let title, ancestors, owner;
    if (pathSegs.length >= 2) {
      title = pathSegs[pathSegs.length - 1];
      ancestors = pathSegs.slice(0, -1);
      owner = ancestors[ancestors.length - 1] || "";
    } else if (isAgentDb) {
      title = dfn;            // Document Name
      owner = name;           // Agent Name
      ancestors = name ? [name] : [];
    } else {
      title = name || pathSegs[pathSegs.length - 1] || dfn;
      owner = name;
      ancestors = [];
    }

    const content = proseCells.map((c) => htmlCellToMarkdown(c)).filter(Boolean).join("\n\n");

    nodes.push({
      section, dfn, doc_no, title, type,
      ancestors, owner,
      content,
      contentHash: md5(content),
      // structural key (plan §4.2 tier 2): section + ancestor path + owner + title.
      // The owner (breadcrumb parent / Agent) de-collides bare temp-name rows.
      structuralKey: norm([section, ...ancestors, owner, title].join(" | ")),
      order: i,
    });
  }

  // Owning parent by POSITION (plan §2c). The HTML encodes hierarchy by order, not by field:
  // a process's template children ("Required Primitive Inputs", "Process Flow", …) carry an EMPTY
  // breadcrumb and a shared coarse doc_no, so their owner is recoverable only as the nearest
  // preceding SAME-SECTION row that DOES carry a breadcrumb — the process/element doc above the
  // block. This is the sole disambiguator for the fully-identical stub groups (measured: separates
  // 69 groups that title+ancestors+content leave indistinguishable).
  let lastParent = null, lastParentSection = null;
  for (const n of nodes) {
    n.parentTitle = lastParentSection === n.section ? lastParent : null;
    if (n.ancestors.length) { lastParent = n.title; lastParentSection = n.section; }
  }
  return nodes;
}

/** Read + parse the HTML atlas at a git commit. */
export function loadHtmlAt(hash, repoDir) {
  const raw = execSync(`git -C "${repoDir}" show ${hash}:'${HTML_PATH}'`, { maxBuffer: 1 << 30 }).toString();
  return parseHtmlToNodes(raw);
}

export const _internal = { textOf, norm, DOCNO };
