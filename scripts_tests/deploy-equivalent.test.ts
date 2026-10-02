import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ancestorsFromGit, deployEquivalentShas } from "../scripts/lib/deploy-equivalent.mjs";

describe("deployEquivalentShas", () => {
  it("adds older commits while their diff to head is markdown the app does not read", () => {
    const ancestors = [
      { sha: "b", changedSinceHead: ["src/server/chat/AGENTS.md"] },
      { sha: "c", changedSinceHead: [] },
      { sha: "d", changedSinceHead: ["CLAUDE.md", "src/server/chat.ts"] },
      { sha: "e", changedSinceHead: ["CLAUDE.md"] },
    ];
    expect(deployEquivalentShas("a", ancestors)).toEqual(["a", "b", "c"]);
  });

  it("stops at app-read markdown, which Railway deploys", () => {
    expect(deployEquivalentShas("a", [{ sha: "b", changedSinceHead: ["patch-notes.md"] }])).toEqual(["a"]);
  });

  it("is head alone with no ancestors", () => {
    expect(deployEquivalentShas("a", [])).toEqual(["a"]);
  });
});

describe("ancestorsFromGit", () => {
  it("lists the commits older than head with their diff to head", () => {
    const git = (args: string[]) => (args[0] === "rev-list" ? ["head", "b", "c"] : [`${args[2]}-changed.md`]);
    expect(ancestorsFromGit("head", "base", 20, git)).toEqual([
      { sha: "b", changedSinceHead: ["b-changed.md"] },
      { sha: "c", changedSinceHead: ["c-changed.md"] },
    ]);
  });

  it("asks git for at most limit ancestors, plus head", () => {
    const calls: string[][] = [];
    ancestorsFromGit("head", "base", 3, (args: string[]) => (calls.push(args), []));
    expect(calls[0]).toEqual(["rev-list", "--first-parent", "--max-count=4", "base..head"]);
  });

  it("returns [] when git fails, so the gate waits for head alone", () => {
    const git = () => {
      throw new Error("bad revision");
    };
    expect(ancestorsFromGit("head", "base", 20, git)).toEqual([]);
  });

  it("parses real git output for the arguments it builds", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-equivalent-"));
    const run = (args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    const git = (args: string[]) => run(args).split("\n").filter(Boolean);
    run(["init", "-q"]);
    const commit = (file: string) => {
      fs.writeFileSync(path.join(dir, file), file);
      run(["add", file]);
      run(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", file]);
      return run(["rev-parse", "HEAD"]).trim();
    };
    const base = commit("base.ts");
    const code = commit("app.ts");
    const head = commit("NOTES.md");
    expect(ancestorsFromGit(head, base, 20, git)).toEqual([{ sha: code, changedSinceHead: ["NOTES.md"] }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
