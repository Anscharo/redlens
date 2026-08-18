// Layout detection + reassembly for atlas-source.mjs.
//
// The atlas has regrouped its files twice (a monolith → ~11k document.md →
// ~16 composed files) and will again. These tests pin the two things that fail
// SILENTLY when it does: mis-detecting a layout, and mis-ordering the composed
// buckets.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// @ts-expect-error — .mjs sibling; the .d.mts covers the server import, not this
import {
  LAYOUT,
  AtlasSourceError,
  bucketFromFilename,
  bucketOrderKey,
  compareBuckets,
  listBuckets,
  readConsolidated,
  detectLayout,
  loadAtlasSource,
} from "./atlas-source.mjs";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-source-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a file, creating parents. Paths are relative to the atlas repo root. */
function write(rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

/** A composed heading line at `depth` hashes. */
function heading(depth: number, docNo: string, title: string, uuid: string): string {
  return `${"#".repeat(depth)} ${docNo} - ${title} [Core]  <!-- UUID: ${uuid} -->`;
}

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("bucket filenames", () => {
  it("recovers a bucket doc number, and ignores non-bucket files", () => {
    expect(bucketFromFilename("A.0 - Atlas-Preamble.md")).toBe("A.0");
    expect(bucketFromFilename("A.6.1.1.7 - Osero.md")).toBe("A.6.1.1.7");
    expect(bucketFromFilename("_index.md")).toBeNull();
    expect(bucketFromFilename("document.md")).toBeNull();
    expect(bucketFromFilename("README.md")).toBeNull();
    expect(bucketFromFilename("A.1 - No Extension")).toBeNull();
  });

  it("orders buckets by integer segments, not by filename", () => {
    expect(bucketOrderKey("A.6.1.1.7")).toEqual([6, 1, 1, 7]);
    // A prefix sorts before its extensions, as upstream's Python tuples do.
    expect(compareBuckets("A.6", "A.6.1.1.1")).toBeLessThan(0);
    // 1 < 2 at the third segment: every Star artifact precedes the Executor list.
    expect(compareBuckets("A.6.1.1.8", "A.6.1.2")).toBeLessThan(0);
  });

  it("keeps a tenth Star in place — the trap filename sorting falls into", () => {
    // Lexicographically "A.6.1.1.10" sorts between ".1" and ".2", which would
    // silently reorder ~2,000 documents. Sky expects to onboard more Agents, so
    // this is a matter of when, not if.
    const order = ["A.6.1.1.10", "A.6.1.1.2", "A.6.1.1.1"].sort(compareBuckets);
    expect(order).toEqual(["A.6.1.1.1", "A.6.1.1.2", "A.6.1.1.10"]);
    expect([...order].sort()).not.toEqual(order); // string sort disagrees — the point
  });
});

describe("detectLayout", () => {
  it("detects the consolidated layout from its bucket files", () => {
    write("content/A.0 - Preamble.md", heading(1, "A.0", "Preamble", U(1)));
    expect(detectLayout(dir)).toBe(LAYOUT.CONSOLIDATED);
  });

  it("detects the atomized layout from its root scope document", () => {
    write("content/A/0/document.md", "---\nid: x\n---\n\n# h\n");
    expect(detectLayout(dir)).toBe(LAYOUT.ATOMIZED);
  });

  it("detects the pre-decomposition monolith", () => {
    write("Sky Atlas/Sky Atlas.md", heading(1, "A.0", "Preamble", U(1)));
    expect(detectLayout(dir)).toBe(LAYOUT.MONOLITH);
  });

  it("refuses to guess when a checkout matches BOTH layouts", () => {
    write("content/A.0 - Preamble.md", "x");
    write("content/A/0/document.md", "---\nid: x\n---\n");
    expect(() => detectLayout(dir)).toThrow(/half-finished migration/);
  });

  it("refuses to read an empty content/ as a pre-cutover ref", () => {
    // The failure this whole seam exists to prevent: a truncated checkout and an
    // old layout are indistinguishable if "no documents found" means "try the
    // other reader". It must be an error, not a fallback.
    fs.mkdirSync(path.join(dir, "content"));
    expect(() => detectLayout(dir)).toThrow(/matches neither layout/);
  });

  it("refuses an unpopulated submodule", () => {
    expect(() => detectLayout(dir)).toThrow(/not\s+populated|no content/i);
  });
});

describe("readConsolidated", () => {
  it("reassembles buckets in doc-number order, joined with a newline", () => {
    write("content/A.0 - Preamble.md", "first\n");
    write("content/A.6 - Agent-Scope.md", "spine\n");
    write("content/A.6.1.1.1 - Spark.md", "spark\n");
    write("content/A.6.1.1.10 - Tenth-Star.md", "tenth\n");
    write("content/A.6.1.2 - Executors.md", "executors\n");
    write("content/README.md", "IGNORED\n"); // not a bucket file

    expect(listBuckets(path.join(dir, "content")).map((b: { bucket: string }) => b.bucket)).toEqual([
      "A.0",
      "A.6",
      "A.6.1.1.1",
      "A.6.1.1.10",
      "A.6.1.2",
    ]);
    // Each file already ends with "\n", and join adds one more → the blank line
    // that separates documents in the composed monolith.
    expect(readConsolidated(path.join(dir, "content"))).toBe(
      "first\n\nspine\n\nspark\n\ntenth\n\nexecutors\n",
    );
  });

  it("throws when two files claim the same bucket", () => {
    write("content/A.1 - One.md", "a");
    write("content/A.1 - Duplicate.md", "b");
    expect(() => readConsolidated(path.join(dir, "content"))).toThrow(/two files claim bucket A\.1/);
  });
});

describe("loadAtlasSource", () => {
  it("reads a consolidated checkout as one composed document stream", () => {
    write(
      "content/A.0 - Preamble.md",
      [heading(1, "A.0", "Preamble", U(1)), "", "intro", "", heading(2, "A.0.1", "First", U(2)), "", "body", ""].join("\n"),
    );
    write(
      "content/A.1 - Governance.md",
      [heading(1, "A.1", "Governance", U(3)), "", "gov body", ""].join("\n"),
    );

    const { layout, nodes } = loadAtlasSource(dir, { minNodes: 0 });
    expect(layout).toBe(LAYOUT.CONSOLIDATED);
    expect(nodes.map((n: { doc_no: string }) => n.doc_no)).toEqual(["A.0", "A.0.1", "A.1"]);
    // parentId resolves ACROSS the file boundary — the whole point of composing
    // before parsing rather than parsing each bucket on its own.
    expect(nodes[1].parentId).toBe(U(1));
    expect(nodes[2].parentId).toBeNull();
    expect(nodes[0].content).toBe("intro");
  });

  it("refuses to hand back an implausibly small atlas", () => {
    // The regression that motivated the floor: post-#294 `content/` still
    // existed, the atomized walk found nothing, and the build published an
    // EMPTY docs.json with no error anywhere.
    write("content/A.0 - Preamble.md", heading(1, "A.0", "Preamble", U(1)));
    expect(() => loadAtlasSource(dir)).toThrow(AtlasSourceError);
    expect(() => loadAtlasSource(dir)).toThrow(/Refusing to publish an empty atlas/);
  });
});

describe("loadAtlasSource across layouts", () => {
  // The consolidated case is covered above. These are the two older layouts,
  // which still have to work: build-history replays them, build-at rebuilds at
  // an old atlas commit, and a preview of a pre-cutover PR parses one.
  it("reads an atomized checkout", () => {
    const doc = (rel: string, id: string, docNo: string, name: string, body: string) => {
      write(`content/${rel}/document.md`,
        ["---", `id: ${id}`, `docNo: ${docNo}`, `name: ${name}`, "type: Core", "---", "", "# h", "", body, ""].join("\n"));
    };
    // `content/A/0/document.md` is the atomized layout's marker (mirroring
    // upstream's detect_layout), so the fixture has to carry a real A/0.
    doc("A", U(1), "A", "Root", "root body");
    doc("A/0", U(2), "A.0", "Preamble", "preamble body");
    doc("A/0/1", U(3), "A.0.1", "Child", "child body");

    const { layout, nodes } = loadAtlasSource(dir, { minNodes: 0 });
    expect(layout).toBe(LAYOUT.ATOMIZED);
    expect(nodes.map((n: { doc_no: string }) => n.doc_no)).toEqual(["A", "A.0", "A.0.1"]);
    expect(nodes.map((n: { depth: number }) => n.depth)).toEqual([1, 2, 3]);
    expect(nodes[1].parentId).toBe(U(1));
    expect(nodes[2].parentId).toBe(U(2));
  });

  it("reads a pre-decomposition monolith", () => {
    write("Sky Atlas/Sky Atlas.md",
      [heading(1, "A.0", "Preamble", U(1)), "", "intro", "", heading(2, "A.0.1", "First", U(2)), "", "body", ""].join("\n"));

    const { layout, nodes } = loadAtlasSource(dir, { minNodes: 0 });
    expect(layout).toBe(LAYOUT.MONOLITH);
    expect(nodes.map((n: { doc_no: string }) => n.doc_no)).toEqual(["A.0", "A.0.1"]);
    expect(nodes[1].parentId).toBe(U(1));
  });

  it("honours the ATLAS_MIN_NODES floor override", () => {
    write("content/A.0 - Preamble.md", heading(1, "A.0", "Preamble", U(1)));
    const prev = process.env.ATLAS_MIN_NODES;
    try {
      process.env.ATLAS_MIN_NODES = "0";
      expect(loadAtlasSource(dir).nodes).toHaveLength(1);
      process.env.ATLAS_MIN_NODES = "5";
      expect(() => loadAtlasSource(dir)).toThrow(/floor 5/);
    } finally {
      if (prev === undefined) delete process.env.ATLAS_MIN_NODES;
      else process.env.ATLAS_MIN_NODES = prev;
    }
  });
});

describe("listBuckets edge cases", () => {
  it("ignores a DIRECTORY whose name matches the bucket pattern", () => {
    // Only files are buckets. A directory named like one would otherwise be
    // read as a bucket and blow up on readFileSync.
    write("content/A.1 - Real.md", "x\n");
    fs.mkdirSync(path.join(dir, "content", "A.2 - NotAFile.md"), { recursive: true });
    expect(listBuckets(path.join(dir, "content")).map((b: { bucket: string }) => b.bucket)).toEqual(["A.1"]);
  });
});
