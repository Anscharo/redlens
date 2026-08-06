import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  sha256,
  HEADING_RE,
  parse,
  parseTree,
  computeLevels,
  cleanContent,
  unquoteYamlName,
} from "./atlas-parser.mjs";

describe("sha256", () => {
  it("matches node's own sha256 hex digest", () => {
    expect(sha256("abc")).toBe(crypto.createHash("sha256").update("abc", "utf8").digest("hex"));
    expect(sha256("")).toBe(crypto.createHash("sha256").update("", "utf8").digest("hex"));
  });
});

describe("HEADING_RE", () => {
  it("matches a well-formed heading at every depth 1-6", () => {
    for (let depth = 1; depth <= 6; depth++) {
      const line = `${"#".repeat(depth)} A.${depth} - Some Title [Core] <!-- UUID: 11111111-1111-1111-1111-111111111111 -->`;
      const m = line.match(HEADING_RE);
      expect(m).not.toBeNull();
      expect(m![1]).toBe("#".repeat(depth));
      expect(m![2]).toBe(`A.${depth}`);
      expect(m![4]).toBe("Core");
    }
  });

  it("matches an NR-x doc_no and a hyphenated title", () => {
    const line = "## NR-12 - Needs More Research-y Detail [Needed Research] <!-- UUID: 22222222-2222-2222-2222-222222222222 -->";
    const m = line.match(HEADING_RE);
    expect(m![2]).toBe("NR-12");
    expect(m![3]).toBe("Needs More Research-y Detail");
  });

  it("rejects a plain prose line", () => {
    expect(HEADING_RE.test("This is just a paragraph.")).toBe(false);
  });

  it("rejects a heading missing the UUID comment", () => {
    expect(HEADING_RE.test("# A - Root [Scope]")).toBe(false);
  });

  it("rejects more than 6 hashes", () => {
    expect(
      HEADING_RE.test("####### A - Root [Scope] <!-- UUID: 11111111-1111-1111-1111-111111111111 -->"),
    ).toBe(false);
  });
});

function heading(hashes: number, docNo: string, title: string, type: string, uuid: string): string {
  return `${"#".repeat(hashes)} ${docNo} - ${title} [${type}] <!-- UUID: ${uuid} -->`;
}

describe("parse", () => {
  const uA = "11111111-1111-1111-1111-111111111111";
  const uA1 = "22222222-2222-2222-2222-222222222222";
  const uA11 = "33333333-3333-3333-3333-333333333333";
  const uA2 = "44444444-4444-4444-4444-444444444444";
  const uA21 = "55555555-5555-5555-5555-555555555555";

  const src = [
    heading(1, "A", "Root Scope", "Scope", uA),
    "Root content line.",
    "",
    heading(2, "A.1", "First Child", "Article", uA1),
    "Child content.",
    "",
    heading(3, "A.1.1", "Grandchild", "Mystery Type", uA11),
    "Grandchild content.",
    "",
    heading(2, "A.2", "Second Child", "Article", uA2),
    "Second child content.",
    "",
    heading(3, "A.2.1", "Second Grandchild", "Core", uA21),
    "Deep content.",
  ].join("\n");

  it("parses every node with its fields, hashing raw content", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { nodes, nodeMap } = parse(src);
    expect(nodes).toHaveLength(5);
    expect(nodeMap[uA].doc_no).toBe("A");
    expect(nodes[0].content).toBe("Root content line.");
    expect(nodes[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(nodes[2].content).toBe("Grandchild content.");
  });

  it("resolves parentId via a depth-indexed ancestor stack, clearing deeper slots on a shallower sibling", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { nodes } = parse(src);
    const [a, a1, a11, a2, a21] = nodes;
    expect(a.parentId).toBeNull();
    expect(a1.parentId).toBe(uA);
    expect(a11.parentId).toBe(uA1);
    // A.2 returns to depth 2 — must re-parent under A, not linger under A.1.1.
    expect(a2.parentId).toBe(uA);
    // A.2.1's depth-3 ancestor slot must now be A.2, not the stale A.1.1.
    expect(a21.parentId).toBe(uA2);
  });

  it("warns once per unknown document type, naming the type and first doc_no", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parse(src);
    const calls = warn.mock.calls.map((c) => String(c[0]));
    const hit = calls.filter((c) => c.includes("Mystery Type"));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toContain("A.1.1");
    expect(hit[0]).toContain("[drift]");
  });

  it("ignores content before the first heading", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const withPreamble = "Some preamble that isn't under any node.\n" + src;
    const { nodes } = parse(withPreamble);
    expect(nodes).toHaveLength(5);
    expect(nodes[0].content).toBe("Root content line.");
  });

  it("seals and hashes the final node's trailing content", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { nodes } = parse(src + "\nfinal trailing line");
    expect(nodes[nodes.length - 1].content).toBe("Deep content.\nfinal trailing line");
  });
});

describe("cleanContent", () => {
  it("preserves a same-line backtick-wrapped span as inline code", () => {
    expect(cleanContent(["prose `inline code` more prose"])).toBe("prose `inline code` more prose");
  });

  it("passes through a line whose closing backtick appears mid-line", () => {
    expect(cleanContent(["`1`. enumerator-style line"])).toBe("`1`. enumerator-style line");
  });

  it("converts a closed multi-line backtick block into a fenced code block", () => {
    const lines = ["prose before", "`first code line", "second code line", "last code line`", "prose after"];
    expect(cleanContent(lines)).toBe(
      ["prose before", "```", "first code line", "second code line", "last code line", "```", "prose after"].join("\n"),
    );
  });

  it("flushes an unclosed multi-line block as a fenced code block rather than dropping it", () => {
    const lines = ["prose", "`opens but never closes", "still inside"];
    expect(cleanContent(lines)).toBe(["prose", "```", "opens but never closes", "still inside", "```"].join("\n"));
  });

  it("trims leading/trailing whitespace from the joined result", () => {
    expect(cleanContent(["", "content", ""])).toBe("content");
  });

  it("passes through ordinary lines with no backticks unchanged", () => {
    expect(cleanContent(["one", "two", "three"])).toBe("one\ntwo\nthree");
  });
});

describe("unquoteYamlName", () => {
  it("unwraps a double-quoted value and unescapes \\\" and \\\\", () => {
    expect(unquoteYamlName('"Say \\"Hi\\""')).toBe('Say "Hi"');
    expect(unquoteYamlName('"back\\\\slash"')).toBe("back\\slash");
  });

  it("unwraps a single-quoted value and collapses doubled '' to '", () => {
    expect(unquoteYamlName("'It''s fine'")).toBe("It's fine");
  });

  it("passes a bare unquoted value through unchanged (after trim)", () => {
    expect(unquoteYamlName("  Plain Name  ")).toBe("Plain Name");
  });
});

describe("computeLevels", () => {
  it("breaks a self-referential NR cycle at level 2 (1 + the recursion-guard's level-1 fallback)", () => {
    const doc = { uuid: "nr1", doc_no: "NR-1", targets: ["nr1"], folderPath: [] as string[] };
    const levels = computeLevels([doc], "/unused");
    expect(levels.get("nr1")).toBe(2);
  });

  it("resolves a mutual NR->NR cycle without infinite recursion", () => {
    const nr1 = { uuid: "nr1", doc_no: "NR-1", targets: ["nr2"], folderPath: [] as string[] };
    const nr2 = { uuid: "nr2", doc_no: "NR-2", targets: ["nr1"], folderPath: [] as string[] };
    const levels = computeLevels([nr1, nr2], "/unused");
    // nr2 resolves first (hits nr1's in-progress guard -> level 1 -> +1 = 2),
    // then nr1 resolves against nr2's now-cached level (2 -> +1 = 3).
    expect(levels.get("nr2")).toBe(2);
    expect(levels.get("nr1")).toBe(3);
  });

  it("chains an NR's level off a real doc's level (fs-free: root-level folderPath)", () => {
    const real = { uuid: "real", doc_no: "A", targets: [] as string[], folderPath: ["A"] };
    const nr = { uuid: "nr", doc_no: "NR-9", targets: ["real"], folderPath: [] as string[] };
    const levels = computeLevels([real, nr], "/unused");
    expect(levels.get("real")).toBe(1);
    expect(levels.get("nr")).toBe(2);
  });

  it("caps a long NR->NR->...->real chain at level 6", () => {
    const real = { uuid: "real", doc_no: "A", targets: [] as string[], folderPath: ["A"] };
    const chain = [real];
    let prevUuid = "real";
    for (let i = 1; i <= 6; i++) {
      const uuid = `nr${i}`;
      chain.push({ uuid, doc_no: `NR-${i}`, targets: [prevUuid], folderPath: [] });
      prevUuid = uuid;
    }
    const levels = computeLevels(chain, "/unused");
    expect(levels.get("nr5")).toBe(6); // 1(real)+5 hops = 6, right at the cap
    expect(levels.get("nr6")).toBe(6); // would be 7 — capped
  });

  it("falls back to level 1 for an NR whose target isn't in the doc set", () => {
    const orphan = { uuid: "nr", doc_no: "NR-1", targets: ["missing-uuid"], folderPath: [] as string[] };
    const levels = computeLevels([orphan], "/unused");
    expect(levels.get("nr")).toBe(1);
  });
});

describe("parseTree (fixture directory)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, frontmatter: Record<string, string>, contentLines: string[]): void {
    const full = path.join(dir, rel, "document.md");
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const fm = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const body = ["---", fm, "---", "", "# heading line (discarded)", ...contentLines].join("\n");
    fs.writeFileSync(full, body);
  }

  it("walks content/**, resolves NR placement + levels, and links parentId depth-first", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-parser-tree-"));
    write("A", { id: "u-a", docNo: "A", name: "Root", type: "Scope" }, ["Root content"]);
    write("A/1", { id: "u-a1", docNo: "A.1", name: "Section One", type: "Article" }, ["Article content"]);
    write("A/1/1", { id: "u-a11", docNo: "A.1.1", name: "Core One", type: "Core" }, ["Core content"]);
    write(
      "A/1/nr",
      { id: "u-nr1", docNo: "NR-1", name: "Some Research", type: "Needed Research", targets: "[u-a1]" },
      ["NR content"],
    );

    const { nodes, nodeMap } = parseTree(dir);

    expect(nodes.map((n) => n.doc_no)).toEqual(["A", "A.1", "NR-1", "A.1.1"]);
    expect(nodes.map((n) => n.depth)).toEqual([1, 2, 3, 3]);

    expect(nodeMap["u-a"].parentId).toBeNull();
    expect(nodeMap["u-a1"].parentId).toBe("u-a");
    expect(nodeMap["u-nr1"].parentId).toBe("u-a1");
    expect(nodeMap["u-a11"].parentId).toBe("u-a1");
    expect(nodeMap["u-a1"].title).toBe("Section One");
    expect(nodeMap["u-a11"].content).toBe("Core content");
  });

  it("throws on a doc_no / folder path mismatch", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-parser-tree-"));
    write("A", { id: "u-a", docNo: "A", name: "Root", type: "Scope" }, ["x"]);
    write("A/9", { id: "u-a9", docNo: "A.5", name: "Mismatched", type: "Article" }, ["x"]);
    expect(() => parseTree(dir)).toThrow(/path\/docNo mismatch/);
  });

  it("throws when a document.md is missing its frontmatter id", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-parser-tree-"));
    write("A", { docNo: "A", name: "Root", type: "Scope" }, ["x"]);
    expect(() => parseTree(dir)).toThrow(/missing frontmatter id/);
  });

  it("throws when a document.md doesn't start with '---'", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-parser-tree-"));
    fs.mkdirSync(path.join(dir, "A"), { recursive: true });
    fs.writeFileSync(path.join(dir, "A", "document.md"), "not frontmatter at all");
    expect(() => parseTree(dir)).toThrow(/does not start with ---/);
  });

  it("throws when a document.md's frontmatter is unterminated", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-parser-tree-"));
    fs.mkdirSync(path.join(dir, "A"), { recursive: true });
    fs.writeFileSync(path.join(dir, "A", "document.md"), "---\nid: u-a\ndocNo: A\n");
    expect(() => parseTree(dir)).toThrow(/unterminated frontmatter/);
  });

  it("throws on a malformed (non-list) targets field", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-parser-tree-"));
    write("A", { id: "u-a", docNo: "A", name: "Root", type: "Scope" }, ["x"]);
    write(
      "A/nr",
      { id: "u-nr", docNo: "NR-1", name: "Bad Targets", type: "Needed Research", targets: "not-a-list" },
      ["x"],
    );
    expect(() => parseTree(dir)).toThrow(/expected YAML inline list/);
  });
});
