// The GitTreeBackend seam. atlas-git-source.ts holds every layout decision and
// reads trees only through a backend, so a backend that is not the git CLI (the
// preview's in-process git) must load exactly the snapshots the CLI does. This
// pins that with an in-memory backend built from the same fixture commits.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { makeAtlasGitSource, makeAtlasTreeReader, type GitTreeBackend, type GitTreeEntry } from "./atlas-git-source.ts";

let repo: string;
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

function write(rel: string, body: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), body);
}
function commit(message: string): string {
  git("add", "-A");
  git("-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

/** Every file at `sha` as path → { sha, text }, read once with the CLI. */
function flatTree(sha: string): Map<string, { sha: string; text: string }> {
  const files = new Map<string, { sha: string; text: string }>();
  for (const rec of git("ls-tree", "-r", "-z", sha).split("\0").filter(Boolean)) {
    const [meta, p] = rec.split("\t");
    const blob = meta.split(" ")[2];
    files.set(p, { sha: blob, text: git("cat-file", "blob", blob) + "\n" });
  }
  return files;
}

/** An in-memory backend over flatTree snapshots, honouring the listTree contract. */
function memoryBackend(trees: Map<string, Map<string, { sha: string; text: string }>>): GitTreeBackend {
  const texts = new Map<string, string>();
  for (const t of trees.values()) for (const f of t.values()) texts.set(f.sha, f.text);
  return {
    async listTree(treeish, dir, recursive) {
      const out = new Map<string, GitTreeEntry>();
      for (const [p, f] of trees.get(treeish) ?? []) {
        if (!p.startsWith(`${dir}/`)) continue;
        const rest = p.slice(dir.length + 1).split("/");
        if (recursive || rest.length === 1) out.set(p, { type: "blob", sha: f.sha, path: p });
        else out.set(`${dir}/${rest[0]}`, { type: "tree", sha: "-", path: `${dir}/${rest[0]}` });
      }
      return [...out.values()];
    },
    async readBlobs(blobs) {
      return blobs.map((b) => ({ ...b, raw: texts.get(b.sha)! }));
    },
  };
}

const heading = (n: number, docNo: string, hashes = "#") => `${hashes} ${docNo} - Doc${n} [Core]  <!-- UUID: ${U(n)} -->\n\nbody ${n}\n`;
const MONOLITH = heading(1, "A.0") + "\n" + heading(2, "A.0.1", "##");
const atomizedDoc = (n: number, docNo: string) =>
  ["---", `id: ${U(n)}`, `docNo: ${docNo}`, `name: Doc${n}`, "type: Core", "---", "", "# h", "", `body ${n}`, ""].join("\n");

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-git-backend-"));
  git("init", "-q", "-b", "main");
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("GitTreeBackend seam", () => {
  it("an in-memory backend loads the same snapshot as the git CLI, in every layout", async () => {
    write("Sky Atlas/Sky Atlas.md", MONOLITH);
    const mono = commit("monolith");
    fs.rmSync(path.join(repo, "Sky Atlas"), { recursive: true });
    write("content/A/0/document.md", atomizedDoc(1, "A.0"));
    write("content/A/0/1/document.md", atomizedDoc(2, "A.0.1"));
    const atomized = commit("atomize");
    fs.rmSync(path.join(repo, "content"), { recursive: true });
    write("content/A.0 - Preamble.md", MONOLITH);
    write("content/A.6.1.1.10 - Tenth.md", heading(10, "A.6.1.1.10"));
    write("content/A.6.1.1.2 - Grove.md", heading(3, "A.6.1.1.2"));
    const consolidated = commit("consolidate");

    const shas = [mono, atomized, consolidated];
    const cli = makeAtlasGitSource(repo);
    const mem = makeAtlasTreeReader(memoryBackend(new Map(shas.map((s) => [s, flatTree(s)]))));
    for (const sha of shas) {
      expect(await mem.detectFormat(sha)).toBe(await cli.detectFormat(sha));
      const [a, b] = [await cli.loadSnapshot(sha), await mem.loadSnapshot(sha)];
      expect([...b.entries()]).toEqual([...a.entries()]); // order included
    }
  });

  it("the CLI backend reads a bucket file whose name git would quote", async () => {
    write("content/A.0 - Préambule.md", MONOLITH);
    const sha = commit("non-ascii bucket");
    const snap = await makeAtlasGitSource(repo).loadSnapshot(sha);
    expect(snap.get(U(1))!.path).toBe("content/A.0 - Préambule.md");
    expect(snap.size).toBe(2);
  });
});
