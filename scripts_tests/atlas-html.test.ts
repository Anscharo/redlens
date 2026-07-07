// Golden + invariant tests for the HTML-era converter/parser (plan §3, §10).
// The converter's job is DETERMINISM, not fidelity: every HTML-era diff runs both
// sides through this same converter so artifacts cancel (plan §1). These pin the
// per-section column mapping, the structural key, and convert-twice stability.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import
import { parseHtmlToNodes, htmlCellToMarkdown } from "../scripts/htmlhist/atlas-html.mjs";

const FIXTURE = `
<h1>Articles</h1>
<table>
  <tr>
    <td><dfn>A.0.1 - Atlas Preamble - Definitions - Organizational Alignment</dfn></td>
    <td>Organizational Alignment</td>
    <td>Core</td>
    <td>The <strong>aligned</strong> structure.<ul><li>one</li><li>two</li></ul></td>
  </tr>
</table>
<h1>Agent Scope Database</h1>
<table>
  <tr>
    <td><dfn>Active Instances</dfn></td>
    <td>Spark</td>
    <td>Core</td>
    <td>The instances are stored here.</td>
  </tr>
</table>
`;

describe("htmlCellToMarkdown — deterministic cell conversion", () => {
  it("converts emphasis + lists to pinned markdown", () => {
    const md = htmlCellToMarkdown("The <strong>aligned</strong> structure.<ul><li>one</li><li>two</li></ul>");
    expect(md).toContain("**aligned**");
    expect(md).toContain("-   one"); // turndown pads the bullet marker (deterministic)
    expect(md).toContain("-   two");
  });
  it("is idempotent and trims trailing whitespace", () => {
    const a = htmlCellToMarkdown("<p>x </p>");
    const b = htmlCellToMarkdown("<p>x </p>");
    expect(a).toBe(b);
    expect(a).toBe("x");
  });
  it("empty / whitespace cell → empty string", () => {
    expect(htmlCellToMarkdown("")).toBe("");
    expect(htmlCellToMarkdown("   ")).toBe("");
  });

  it("recovers inline • / ◦ bullet lists into markdown (with nesting)", () => {
    const md = htmlCellToMarkdown(
      "Intro:• <strong>Create</strong> Document ◦ Sub-item one• New Value: Activated",
    );
    expect(md).toBe(
      "Intro:\n\n-   **Create** Document\n    -   Sub-item one\n-   New Value: Activated",
    );
  });

  it("inline-bullet list and equivalent <ul> convert to IDENTICAL markdown (diff cancels at a reformat)", () => {
    const inline = htmlCellToMarkdown("Scopes:• The Governance Scope.• The Support Scope.");
    const ul = htmlCellToMarkdown("Scopes:<ul><li>The Governance Scope.</li><li>The Support Scope.</li></ul>");
    expect(inline).toBe(ul);
  });

  it("leaves prose without bullet characters untouched", () => {
    expect(htmlCellToMarkdown("A plain sentence, no bullets.")).toBe("A plain sentence, no bullets.");
  });
});

describe("parseHtmlToNodes — per-section column mapping", () => {
  const nodes = parseHtmlToNodes(FIXTURE);

  it("parses one node per document row", () => {
    expect(nodes.length).toBe(2);
  });

  it("breadcrumb dfn → doc_no + ancestors + leaf title (Articles)", () => {
    const n = nodes[0];
    expect(n.section).toBe("Articles");
    expect(n.doc_no).toBe("A.0.1");
    expect(n.title).toBe("Organizational Alignment");
    expect(n.ancestors).toEqual(["Atlas Preamble", "Definitions"]);
    expect(n.type).toBe("Core");
    expect(n.content).toContain("**aligned**");
    expect(n.content).toContain("-   one");
  });

  it("Agent Scope DB → dfn is the title, Name cell is the OWNER (agent), not the title", () => {
    const n = nodes[1];
    expect(n.section).toBe("Agent Scope Database");
    expect(n.title).toBe("Active Instances"); // doc-name from the dfn
    expect(n.owner).toBe("Spark");            // agent column
    expect(n.type).toBe("Core");
    expect(n.content).toBe("The instances are stored here.");
    expect(n.structuralKey).toBe("agent scope database spark spark active instances");
  });
});

describe("convert-twice determinism + minimal-diff (artifact cancellation)", () => {
  it("re-parsing identical HTML yields identical content hashes", () => {
    const a = parseHtmlToNodes(FIXTURE);
    const b = parseHtmlToNodes(FIXTURE);
    expect(a.map((n: any) => n.contentHash)).toEqual(b.map((n: any) => n.contentHash));
  });

  it("a one-word prose change touches only that node's content hash", () => {
    const base = parseHtmlToNodes(FIXTURE);
    const edited = parseHtmlToNodes(FIXTURE.replace("stored here", "stored herein"));
    expect(edited[0].contentHash).toBe(base[0].contentHash); // unrelated node unchanged
    expect(edited[1].contentHash).not.toBe(base[1].contentHash); // edited node changed
    expect(edited[1].structuralKey).toBe(base[1].structuralKey); // identity stable across the edit
  });
});
