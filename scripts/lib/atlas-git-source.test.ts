// Per-commit layout detection for the history walk.
//
// build-history replays every commit the atlas ever had, so one run meets all
// three layouts. The failure this guards against is specific and severe: a
// reader that returns an EMPTY map for a layout it does not recognise reads
// downstream as "every document was deleted", gets written to atlas_history,
// and advances the cursor past itself — so the damage is not self-healing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// @ts-expect-error — .mjs sibling, no type declarations needed for this test
import { makeAtlasGitSource, parseMonolithic, extractBody } from "./atlas-git-source.mjs";

let repo: string;
let src: ReturnType<typeof makeAtlasGitSource>;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function write(rel: string, body: string): void {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

/** Commit everything, returning the sha. Identity is set per-command so the
 *  developer's own git config is never read or written, and commit signing is
 *  force-disabled so a machine with `commit.gpgsign=true` and no available key
 *  can't fail the fixture. */
function commit(message: string): string {
  git("add", "-A");
  git(
    "-c", "user.name=test",
    "-c", "user.email=test@example.com",
    "-c", "commit.gpgsign=false",
    "commit", "-q", "-m", message,
  );
  return git("rev-parse", "HEAD");
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-git-src-"));
  git("init", "-q", "-b", "main");
  src = makeAtlasGitSource(repo);
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const MONOLITH = [
  "# A.0 - Preamble [Scope]  <!-- UUID: " + U(1) + " -->",
  "",
  "intro body",
  "",
  "## A.0.1 - First [Core]  <!-- UUID: " + U(2) + " -->",
  "",
  "first body",
  "",
].join("\n");

function writeAtomized(): void {
  write(
    "content/A/0/document.md",
    ["---", `id: ${U(1)}`, "docNo: A.0", "name: Preamble", "type: Scope", "---", "", "# h", "", "intro body", ""].join("\n"),
  );
  write(
    "content/A/0/1/document.md",
    ["---", `id: ${U(2)}`, "docNo: A.0.1", "name: First", "type: Core", "---", "", "## h", "", "first body", ""].join("\n"),
  );
  write("content/_index.md", "nav\n");
}

describe("detectFormat", () => {
  it("classifies each of the three layouts the atlas has shipped", () => {
    write("Sky Atlas/Sky Atlas.md", MONOLITH);
    const mono = commit("monolith");

    fs.rmSync(path.join(repo, "Sky Atlas"), { recursive: true });
    writeAtomized();
    const atomized = commit("atomize");

    fs.rmSync(path.join(repo, "content"), { recursive: true });
    write("content/A.0 - Preamble.md", MONOLITH);
    const consolidated = commit("consolidate");

    expect(src.detectFormat(mono)).toBe("monolithic");
    expect(src.detectFormat(atomized)).toBe("atomized");
    // `content/` exists in BOTH post-#236 layouts, so directory presence alone
    // cannot discriminate — this is exactly the check that used to say
    // "atomized" for a consolidated tree and then find nothing in it.
    expect(src.detectFormat(consolidated)).toBe("consolidated");
  });

  it("throws on a commit with no atlas at all, rather than reporting an empty one", () => {
    write("README.md", "no atlas here\n");
    const sha = commit("empty");
    expect(() => src.detectFormat(sha)).toThrow(/unrecognised atlas layout/);
  });
});

describe("loadSnapshot", () => {
  it("agrees on uuids and contentHashes across all three layouts", () => {
    write("Sky Atlas/Sky Atlas.md", MONOLITH);
    const mono = commit("monolith");

    fs.rmSync(path.join(repo, "Sky Atlas"), { recursive: true });
    writeAtomized();
    const atomized = commit("atomize");

    fs.rmSync(path.join(repo, "content"), { recursive: true });
    write("content/A.0 - Preamble.md", MONOLITH);
    const consolidated = commit("consolidate");

    const a = src.loadSnapshot(mono);
    const b = src.loadSnapshot(atomized);
    const c = src.loadSnapshot(consolidated);

    expect([...a.keys()].sort()).toEqual([U(1), U(2)]);
    expect([...b.keys()].sort()).toEqual([U(1), U(2)]);
    expect([...c.keys()].sort()).toEqual([U(1), U(2)]);

    // The whole reason a regrouping is not a content rewrite: the hash is over
    // the trimmed body, which every layout stores identically. If these drifted,
    // a re-grouping commit would emit a `modified` event for every document.
    for (const id of [U(1), U(2)]) {
      expect(b.get(id)!.contentHash).toBe(a.get(id)!.contentHash);
      expect(c.get(id)!.contentHash).toBe(a.get(id)!.contentHash);
      expect(c.get(id)!.doc_no).toBe(a.get(id)!.doc_no);
      expect(c.get(id)!.title).toBe(a.get(id)!.title);
    }
  });

  it("records the bucket file each document lives in, so re-filing reads as a move", () => {
    write("content/A.0 - Preamble.md", MONOLITH);
    const sha = commit("consolidated");
    const snap = src.loadSnapshot(sha);
    expect(snap.get(U(1))!.path).toBe("content/A.0 - Preamble.md");
    expect(snap.get(U(2))!.path).toBe("content/A.0 - Preamble.md");
  });

  it("reassembles buckets in doc-number order, not filename order", () => {
    // A tenth Star sorts between .1 and .2 as a string. Getting this wrong would
    // reorder documents rather than error, so assert the emitted order directly.
    const doc = (n: number, docNo: string) =>
      `# ${docNo} - Doc${n} [Core]  <!-- UUID: ${U(n)} -->\n\nbody ${n}\n`;
    write("content/A.6.1.1.1 - Spark.md", doc(1, "A.6.1.1.1"));
    write("content/A.6.1.1.2 - Grove.md", doc(2, "A.6.1.1.2"));
    write("content/A.6.1.1.10 - Tenth.md", doc(10, "A.6.1.1.10"));
    const sha = commit("ten stars");

    // Map insertion order follows bucket order, so keys() is the emitted order.
    expect([...src.loadSnapshot(sha).keys()]).toEqual([U(1), U(2), U(10)]);
  });

  it("throws when a classified layout yields no documents", () => {
    // The silent-empty path. A tree that looks atomized but holds no
    // document.md must be an error, never a snapshot of zero documents.
    write("content/A/0/document.md", "---\nid: x\n---\n");
    const sha = commit("atomized");
    fs.rmSync(path.join(repo, "content/A/0/document.md"));
    write("content/A/keep.txt", "still a content dir\n");
    const broken = commit("gutted");

    expect(src.loadSnapshot(sha).size).toBe(1); // the intact tree reads fine…
    expect(src.detectFormat(broken)).toBe("atomized"); // …and the gutted one still looks atomized
    expect(() => src.loadSnapshot(broken)).toThrow(/no content\/\*\*\/document\.md blobs/);
  });
});

describe("parseMonolithic / extractBody", () => {
  it("returns an empty map for empty text", () => {
    expect(parseMonolithic("").size).toBe(0);
    expect(parseMonolithic(null as unknown as string).size).toBe(0);
  });

  it("defaults every node's path to the monolith when none is given", () => {
    const nodes = parseMonolithic(MONOLITH);
    expect(nodes.get(U(1))!.path).toBe("Sky Atlas/Sky Atlas.md");
  });

  it("extractBody strips frontmatter and the heading, and trims", () => {
    expect(extractBody(["---", "id: x", "---", "", "## A.0 - T [Core]", "", "body", "", ""].join("\n"))).toBe("body");
    // No frontmatter and no heading: the whole text is the body.
    expect(extractBody("just a body\n")).toBe("just a body");
    // Heading with no frontmatter is still dropped.
    expect(extractBody("# H\n\nbody\n")).toBe("body");
  });
});
