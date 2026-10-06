// Which conversation a chat turn writes to, and what it may still read. A
// conversation that has read a private repo's PR preview (conversations.
// private_repos) holds that repo's text in its persisted rows, so every turn and
// every reopen re-checks the user's live access to each such repo — the same
// fail-closed check the preview reader uses (preview/access.ts) — and such a
// conversation never sends prompt or response text to PostHog.

import { sql } from "../db.ts";
import type { PageContext } from "./system-prompt.ts";
import { authorizeUserRepoAccess, type AccessDecision } from "../preview/access.ts";
import { CANONICAL_REPO, decodeId } from "../preview/resolve.ts";
import type { ToolCallContext } from "./tools/tool-context.ts";

/** A conversation the caller owns (endpoint/history.ts resolveConversation). */
export interface ResolvedConversation {
  id: string;
  /** Private repos whose preview text this conversation already holds. */
  privateRepos: string[];
}

export type ScopeDenied = { denied: "preview_access_revoked"; status: 403 } | { denied: "access_check_unavailable"; status: 503 };

/** Re-checks the user's live access to every private repo a conversation holds
 *  text from: null when all still pass. An uncertain answer denies. */
export async function reauthorizeRepos(
  userId: string,
  repos: readonly string[],
  authorize: (userId: string, repo: string) => Promise<AccessDecision> = authorizeUserRepoAccess,
): Promise<ScopeDenied | null> {
  const decisions = await Promise.all(repos.map((repo) => authorize(userId, repo)));
  if (decisions.some((x) => x === "unavailable")) return { denied: "access_check_unavailable", status: 503 };
  if (decisions.some((x) => x !== "ok")) return { denied: "preview_access_revoked", status: 403 };
  return null;
}

/** A preview the page names that is not plainly canonical — a fork, a private
 *  mirror, or a bare sha that could be either. Its titles may already be in the
 *  page context, so the turn's text stays out of analytics. */
export function pageNamesNonCanonicalPreview(page: PageContext | undefined): boolean {
  if (!page?.previewId) return false;
  const p = decodeId(page.previewId);
  return !p || p.kind === "sha" || (p.kind === "branch" && p.repo !== CANONICAL_REPO);
}

export interface ConversationScope {
  /** Keep prompt/response text out of PostHog for this turn. */
  privacyMode: boolean;
  /** Records `repo` on the conversation before its private text is returned.
   *  Throws if it cannot record, which withholds the text (tool-access.ts admitPrivate). */
  onPrivateAccess: (repo: string) => Promise<void>;
}

async function recordRepo(convId: string, repo: string): Promise<void> {
  await sql`
    UPDATE conversations SET private_repos = array_append(private_repos, ${repo})
    WHERE id = ${convId} AND NOT (${repo} = ANY(private_repos))
  `;
}

export async function conversationScope(
  userId: string,
  conv: ResolvedConversation,
  page: PageContext | undefined,
  deps: { authorize?: (userId: string, repo: string) => Promise<AccessDecision>; record?: typeof recordRepo } = {},
): Promise<ConversationScope | ScopeDenied> {
  const denied = await reauthorizeRepos(userId, conv.privateRepos, deps.authorize);
  if (denied) return denied;
  const record = deps.record ?? recordRepo;
  const recorded = new Set(conv.privateRepos);
  return {
    privacyMode: recorded.size > 0 || pageNamesNonCanonicalPreview(page),
    onPrivateAccess: async (repo) => {
      if (recorded.has(repo)) return;
      await record(conv.id, repo);
      recorded.add(repo);
    },
  };
}

/** The context a chat turn's tools run under. The private-text hook records the
 *  repo and then turns on `obs.privacyMode`, before the text reaches the model,
 *  so the round that carries it and every later call skip content capture. */
export function chatToolContext(
  userId: string,
  signal: AbortSignal,
  scope: ConversationScope,
  obs: { privacyMode?: boolean },
): ToolCallContext {
  return {
    surface: "chat",
    userId,
    signal,
    onPrivateAccess: async (repo) => {
      await scope.onPrivateAccess(repo);
      obs.privacyMode = true;
    },
  };
}
