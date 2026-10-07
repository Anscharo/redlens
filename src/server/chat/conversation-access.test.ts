// Re-authorizing a conversation that holds private preview text, and the
// privacy flag a turn carries. The database and the GitHub check are injected.
import { test, expect } from "bun:test";
import { conversationScope, reauthorizeRepos, pageNamesNonCanonicalPreview, chatToolContext } from "./conversation-access.ts";
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

test("chatToolContext: reading private text records it, then flips the turn's obs to privacy mode", async () => {
  const order: string[] = [];
  const scope = { privacyMode: false, onPrivateAccess: async (repo: string) => void order.push(`record ${repo}`) };
  const obs: { privacyMode?: boolean } = { privacyMode: false };
  const ctx = chatToolContext("u1", new AbortController().signal, scope, obs);
  expect(ctx).toMatchObject({ surface: "chat", userId: "u1" });
  await ctx.onPrivateAccess!("a/b");
  expect(order).toEqual(["record a/b"]);
  expect(obs.privacyMode).toBe(true);
});

const SHA = "d".repeat(40);
const page = (previewId: string) => ({ previewId, previewSha: SHA });

test("a turn inside a private preview records that repo before any tool runs, and is gated by it", async () => {
  const recorded: string[] = [];
  const record = async (_c: string, repo: string) => void recorded.push(repo);
  const lookup = async () => ({ repo: "Acme/Secret", private: true });
  const ok = await conversationScope("u", { id: "c1", privateRepos: [] }, page("acme:secret:main"), {
    authorize: decide({ "acme/secret": "ok" }),
    record,
    lookup,
  });
  if ("denied" in ok) throw new Error("unexpected");
  expect(recorded).toEqual(["acme/secret"]); // lowercased, one spelling per repo
  expect(ok.privacyMode).toBe(true);
  await ok.onPrivateAccess("ACME/secret");
  expect(recorded).toEqual(["acme/secret"]);

  const denied = await conversationScope("u", { id: "c1", privateRepos: [] }, page("acme:secret:main"), {
    authorize: decide({}),
    record,
    lookup,
  });
  expect(denied).toMatchObject({ denied: "preview_access_revoked" });
});

test("a public fork preview or a canonical PR records nothing; a failed lookup denies with 503", async () => {
  const recorded: string[] = [];
  const record = async (_c: string, repo: string) => void recorded.push(repo);
  const publicFork = async () => ({ repo: "acme/fork", private: false });
  expect("denied" in (await conversationScope("u", { id: "c", privateRepos: [] }, page("acme:main"), { record, lookup: publicFork }))).toBe(false);
  const never = async () => {
    throw new Error("canonical PRs are never looked up");
  };
  expect("denied" in (await conversationScope("u", { id: "c", privateRepos: [] }, page("pull-3"), { record, lookup: never }))).toBe(false);
  expect(recorded).toEqual([]);
  const broken = async () => Promise.reject(new Error("db down"));
  expect(await conversationScope("u", { id: "c", privateRepos: [] }, page("acme:main"), { lookup: broken })).toMatchObject({ status: 503 });
});
