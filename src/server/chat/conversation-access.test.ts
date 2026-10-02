// Re-authorizing a conversation that holds private preview text, and the
// privacy flag a turn carries. The database and the GitHub check are injected.
import { test, expect } from "bun:test";
import { conversationScope, reauthorizeRepos, pageNamesNonCanonicalPreview } from "./conversation-access.ts";
import { withholdsContent } from "./llm.ts";
import type { AccessDecision } from "../preview/access.ts";

const decide = (byRepo: Record<string, AccessDecision>) => async (_u: string, repo: string) => byRepo[repo] ?? "forbidden";

test("reauthorizeRepos: all ok passes; any revoked is 403; any unavailable is 503", async () => {
  expect(await reauthorizeRepos("u", [], decide({}))).toBeNull();
  expect(await reauthorizeRepos("u", ["a/b", "c/d"], decide({ "a/b": "ok", "c/d": "ok" }))).toBeNull();
  expect(await reauthorizeRepos("u", ["a/b", "c/d"], decide({ "a/b": "ok", "c/d": "forbidden" }))).toEqual({ denied: "preview_access_revoked", status: 403 });
  expect(await reauthorizeRepos("u", ["a/b"], decide({ "a/b": "login-required" }))).toMatchObject({ status: 403 });
  expect(await reauthorizeRepos("u", ["a/b", "c/d"], decide({ "a/b": "unavailable", "c/d": "forbidden" }))).toEqual({ denied: "access_check_unavailable", status: 503 });
});

test("conversationScope: a revoked repo stops the turn before anything runs", async () => {
  const scope = await conversationScope("u", { id: "c1", privateRepos: ["a/b"] }, undefined, { authorize: decide({}) });
  expect(scope).toMatchObject({ denied: "preview_access_revoked" });
});

test("conversationScope: privacy is on once the conversation holds private text, and recording happens once per repo", async () => {
  const recorded: string[] = [];
  const record = async (_c: string, repo: string) => void recorded.push(repo);
  const fresh = await conversationScope("u", { id: "c1", privateRepos: [] }, undefined, { record });
  if ("denied" in fresh) throw new Error("unexpected");
  expect(fresh.privacyMode).toBe(false);
  await fresh.onPrivateAccess("a/b");
  await fresh.onPrivateAccess("a/b");
  expect(recorded).toEqual(["a/b"]);

  const held = await conversationScope("u", { id: "c1", privateRepos: ["a/b"] }, undefined, { authorize: decide({ "a/b": "ok" }), record });
  if ("denied" in held) throw new Error("unexpected");
  expect(held.privacyMode).toBe(true);
  await held.onPrivateAccess("a/b");
  expect(recorded).toEqual(["a/b"]);
});

test("conversationScope: a failed write throws, so the tool withholds the text", async () => {
  const scope = await conversationScope("u", { id: "c1", privateRepos: [] }, undefined, { record: async () => Promise.reject(new Error("db")) });
  if ("denied" in scope) throw new Error("unexpected");
  await expect(scope.onPrivateAccess("a/b")).rejects.toThrow("db");
});

test("a page inside a non-canonical preview turns privacy on; a canonical PR does not", () => {
  expect(pageNamesNonCanonicalPreview(undefined)).toBe(false);
  expect(pageNamesNonCanonicalPreview({ previewId: "pull-12" })).toBe(false);
  expect(pageNamesNonCanonicalPreview({ previewId: "main" })).toBe(false);
  expect(pageNamesNonCanonicalPreview({ previewId: "acme:mirror:pull-3" })).toBe(true);
  expect(pageNamesNonCanonicalPreview({ previewId: "acme:branch" })).toBe(true);
  expect(pageNamesNonCanonicalPreview({ previewId: "a".repeat(40) })).toBe(true);
});

test("withholdsContent: a private conversation never captures text", () => {
  expect(withholdsContent({ privacyMode: true })).toBe(true);
});
