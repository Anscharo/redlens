import { describe, expect, it } from "vitest";

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

  it("reads the real history of this checkout", () => {
    const [first] = ancestorsFromGit("HEAD", "HEAD~2", 5);
    expect(first?.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
