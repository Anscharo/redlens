// Parser invariants for build-index.mjs output.
//
// These check properties of public/docs.json against the source markdown at
// the pinned atlas submodule SHA — so if build-index ever drifts from the
// atlas (loses nodes, mangles structure, hashes the wrong bytes) the build
// fails loudly.
//
// Source is read from content/** (decomposed tree) when present; falls back to
// the composed Sky Atlas.md for pre-decomposition checkouts.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { AtlasNode } from "../src/types";
// @ts-expect-error — .mjs without types; runtime-only import for parser access
import { parse, parseTree, KNOWN_DOC_TYPES, unquoteYamlName } from "../scripts/lib/atlas-parser.mjs";

const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "vendor/next-gen-atlas/content");
const ATLAS_PATH = path.join(ROOT, "vendor/next-gen-atlas/Sky Atlas/Sky Atlas.md");
const DOCS_PATH = path.join(ROOT, "public/docs.json");

// Mirror build-index.mjs: decomposed tree takes priority.
const { nodes: sourceNodes }: { nodes: Array<{ id: string; contentHash: string; doc_no: string }> } =
  fs.existsSync(CONTENT_DIR)
    ? parseTree(CONTENT_DIR)
    : parse(fs.readFileSync(ATLAS_PATH, "utf8"));

const sourceById = new Map(sourceNodes.map((n) => [n.id, n]));
const docs: Record<string, AtlasNode> = JSON.parse(fs.readFileSync(DOCS_PATH, "utf8")).nodes;

describe("parser invariants", () => {
  it("every UUID in the source appears in docs.json", () => {
    const missing = [...sourceById.keys()].filter((id) => !docs[id]);
    expect(missing).toEqual([]);
    expect(Object.keys(docs).length).toBe(sourceById.size);
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

  it("every contentHash in docs.json matches the parser's own hash for that node", () => {
    // The audit primitive: the parser's sha256 of the raw source slice must
    // match what docs.json records. Anyone with the pinned atlas SHA can
    // recompute and verify what redlens shows.
    const mismatches: string[] = [];
    for (const [id, src] of sourceById) {
      if (docs[id]?.contentHash !== src.contentHash)
        mismatches.push(`${src.doc_no} (${id})`);
    }
    expect(mismatches).toEqual([]);
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

describe("unquoteYamlName", () => {
  it("passes bare (unquoted) values through unchanged", () => {
    expect(unquoteYamlName("A.0.1.1 - Something")).toBe("A.0.1.1 - Something");
  });

  it("unescapes a double-quoted value, including embedded escaped quotes/backslashes", () => {
    expect(unquoteYamlName('"a \\"quoted\\" name"')).toBe('a "quoted" name');
    expect(unquoteYamlName('"back\\\\slash"')).toBe("back\\slash");
  });

  it("unescapes a single-quoted value, matching build-history.mjs's unquoteYamlScalar", () => {
    expect(unquoteYamlName("'a name: with a colon'")).toBe("a name: with a colon");
    expect(unquoteYamlName("'it''s doubled'")).toBe("it's doubled");
  });
});
