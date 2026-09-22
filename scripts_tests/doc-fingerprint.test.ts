// The shared document fingerprint (scripts/lib/doc-fingerprint.mjs). Its whole
// value is that ONE document state fingerprints identically whether it was read
// out of upstream's git history (the doc-versions walk, atlas-git-source) or out
// of a checkout / built docs.json (a preview, atlas-source → atlas-parser). If
// the two parsers ever drift, no fork document would match any upstream version
// again — silently: every one of them would just look fork-authored.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — .mjs without types
import { docFingerprint, gitEntryFingerprint } from "../scripts/lib/doc-fingerprint.mjs";
// @ts-expect-error — .mjs without types
import { makeAtlasGitSource } from "../scripts/lib/atlas-git-source.mjs";
import { loadAtlasSource } from "../scripts/lib/atlas-source.mjs";

const ATLAS = path.resolve(__dirname, "../vendor/next-gen-atlas");
const hasAtlas = fs.existsSync(path.join(ATLAS, "content")) || fs.existsSync(path.join(ATLAS, "Sky Atlas"));

describe("docFingerprint", () => {
  const base = { doc_no: "A.1.2", title: "Two", content: "body" };

  it("is 128 bits of hex, and stable", () => {
    expect(docFingerprint(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(docFingerprint({ ...base })).toBe(docFingerprint(base));
  });

  it("changes with the body, the title, AND the doc number — a renumbering is a new state", () => {
    const fp = docFingerprint(base);
    expect(docFingerprint({ ...base, content: "body." })).not.toBe(fp);
    expect(docFingerprint({ ...base, title: "Too" })).not.toBe(fp);
    expect(docFingerprint({ ...base, doc_no: "A.1.3" })).not.toBe(fp);
  });

  it("cannot be confused by moving text between fields", () => {
    expect(docFingerprint({ doc_no: "A.1", title: "X", content: "Y" })).not.toBe(docFingerprint({ doc_no: "A.1", title: "X\nY", content: "" }));
  });

  it("treats a missing body as empty", () => {
    expect(docFingerprint({ doc_no: "A.1", title: "T" })).toBe(docFingerprint({ doc_no: "A.1", title: "T", content: "" }));
  });
});

describe("gitEntryFingerprint", () => {
  it("cleans the raw body first: a multi-line single-backtick block fingerprints like its fenced docs.json form", () => {
    // The atlas authoring quirk cleanContent() exists for — 283 of 11,573 docs.
    const raw = "Intro:\n\n`/// @notice Drop it\nfunction drop() external;`";
    const cleaned = "Intro:\n\n```\n/// @notice Drop it\nfunction drop() external;\n```";
    const entry = { doc_no: "A.1", title: "T", content: raw };
    expect(gitEntryFingerprint(entry)).toBe(docFingerprint({ doc_no: "A.1", title: "T", content: cleaned }));
    expect(gitEntryFingerprint(entry)).not.toBe(docFingerprint(entry));
  });
});

// The tripwire. Needs the submodule's git history, which CI's checkout provides.
describe.skipIf(!hasAtlas)("parity on the checked-out atlas", () => {
  it("every document fingerprints the same from the history walk as from the source loader", () => {
    const src = makeAtlasGitSource(ATLAS);
    const head = src.git("rev-parse HEAD");
    const walk: Map<string, { doc_no: string; title: string; content: string }> = src.loadSnapshot(head);
    const { nodes } = loadAtlasSource(ATLAS) as { nodes: { id: string; doc_no: string; title: string; content: string }[] };

    expect(walk.size).toBe(nodes.length);
    const mismatched = nodes.filter((n) => {
      const e = walk.get(n.id);
      return !e || gitEntryFingerprint(e) !== docFingerprint(n);
    });
    expect(mismatched.map((n) => n.doc_no).slice(0, 5)).toEqual([]);
  }, 60_000);
});
