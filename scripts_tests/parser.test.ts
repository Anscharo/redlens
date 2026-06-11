// Parser invariants for build-index.mjs output.
//
// These check properties of public/docs.json against the source markdown at
// the pinned atlas submodule SHA — so if build-index ever drifts from the
// atlas (loses nodes, mangles structure, hashes the wrong bytes) the build
// fails loudly.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AtlasNode } from "../src/types";
// @ts-expect-error — .mjs import from TypeScript test
import { KNOWN_DOC_TYPES } from "../scripts/lib/atlas-parser.mjs";

const ROOT = path.resolve(__dirname, "..");
const ATLAS_PATH = path.join(ROOT, "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md");
const DOCS_PATH = path.join(ROOT, "public/docs.json");

const HEADING_RE = /^(#{1,6}) ([\w.-]+) - (.+?) \[([^\]]+)\]\s+<!-- UUID: ([0-9a-f-]{36}) -->$/;

const atlasSrc = fs.readFileSync(ATLAS_PATH, "utf8");
const docs: Record<string, AtlasNode> = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8")).nodes;

function sha256(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

describe("parser invariants", () => {
  it("every <!-- UUID: --> in the source appears in docs.json", () => {
    const uuidsInSource = new Set<string>();
    for (const line of atlasSrc.split("\n")) {
      const m = line.match(HEADING_RE);
      if (m) uuidsInSource.add(m[5]);
    }
    const missing: string[] = [];
    for (const uuid of uuidsInSource) {
      if (!docs[uuid]) missing.push(uuid);
    }
    expect(missing).toEqual([]);
    expect(Object.keys(docs).length).toBe(uuidsInSource.size);
  });

  it("every node has all required fields with valid shapes", () => {
    for (const node of Object.values(docs)) {
      expect(node.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(node.doc_no.length).toBeGreaterThan(0);
      expect(node.title.length).toBeGreaterThan(0);
      expect(node.type.length).toBeGreaterThan(0);
      expect(node.depth).toBeGreaterThanOrEqual(1);
      expect(node.depth).toBeLessThanOrEqual(6);
      expect(node.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Array.isArray(node.addressRefs)).toBe(true);
    }
  });

  it("every contentHash reproduces from the raw atlas markdown", () => {
    // The audit primitive: anyone with the pinned atlas SHA can recompute
    // sha256 of any node's raw source slice and verify what redlens shows.
    const raw: Record<string, string[]> = {};
    let cur: string | null = null;
    for (const line of atlasSrc.split("\n")) {
      const m = line.match(HEADING_RE);
      if (m) {
        cur = m[5];
        raw[cur] = [];
      } else if (cur) raw[cur].push(line);
    }
    for (const [id, lines] of Object.entries(raw)) {
      const expected = sha256(lines.join("\n"));
      expect(docs[id]?.contentHash, `mismatch for ${docs[id]?.doc_no ?? id}`).toBe(expected);
    }
  });

  it("docs.json contains at least 10 000 nodes", () => {
    expect(Object.keys(docs).length).toBeGreaterThanOrEqual(10_000);
  });

  it("every document type is spec-defined (a new type means extraction review)", () => {
    // KNOWN_DOC_TYPES mirrors ATLAS_MARKDOWN_SYNTAX.md. A new [Type] in the
    // atlas reaches no extraction pattern until someone reviews it — the
    // parser warns at build time; this keeps CI red until the type is either
    // handled or deliberately added to the known set.
    const unknown = new Map<string, string>(); // type → first doc_no
    for (const d of Object.values(docs)) {
      if (!KNOWN_DOC_TYPES.has(d.type) && !unknown.has(d.type)) unknown.set(d.type, d.doc_no);
    }
    expect([...unknown.entries()]).toEqual([]);
  });

  it("every node's parentId resolves to a real node", () => {
    const orphans: { doc_no: string; parentId: string }[] = [];
    for (const node of Object.values(docs)) {
      if (node.parentId && !docs[node.parentId])
        orphans.push({ doc_no: node.doc_no, parentId: node.parentId });
    }
    expect(orphans).toEqual([]);
  });

  it("every intra-content UUID link resolves to a real node", () => {
    const UUID_LINK =
      /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;
    const orphans: { from: string; to: string }[] = [];
    for (const node of Object.values(docs)) {
      for (const m of node.content.matchAll(UUID_LINK)) {
        if (!docs[m[1]]) orphans.push({ from: node.doc_no, to: m[1] });
      }
    }
    expect(orphans).toEqual([]);
  });

  it("no EVM address extract is the prefix of a longer hex blob", () => {
    // Regression guard for the hex-boundary issue called out in CLAUDE.md —
    // a bad EVM regex would scoop up the leading 40 hex of tx hashes / bytes32
    // / calldata as phantom addresses.
    const phantoms: { node: string; addr: string }[] = [];
    for (const node of Object.values(docs)) {
      for (const addr of node.addressRefs ?? []) {
        if (!addr.startsWith("0x")) continue;
        const bare = addr.slice(2);
        const hits = [...node.content.matchAll(new RegExp(bare, "gi"))];
        for (const m of hits) {
          const start = m.index!;
          const end = start + bare.length;
          const charBefore = node.content[start - 1] ?? "";
          const charAfter = node.content[end] ?? "";
          if (/[0-9a-fA-F]/.test(charBefore) || /[0-9a-fA-F]/.test(charAfter)) {
            phantoms.push({ node: node.doc_no, addr });
            break;
          }
        }
      }
    }
    expect(phantoms).toEqual([]);
  });
});
