// Which conversation a chat turn writes to, and what it may still read. A
// conversation that has read a private repo's PR preview (conversations.
// private_repos) holds that repo's text in its persisted rows, so every turn and
// every reopen re-checks the user's live access to each such repo — the same
// fail-closed check the preview reader uses (preview/access.ts) — and such a
// conversation never sends prompt or response text to PostHog.

import { sql } from "../db.ts";
import { getModel } from "./llm.ts";
import type { PageContext } from "./system-prompt.ts";
import { authorizeUserRepoAccess, type AccessDecision } from "../preview/access.ts";
import { CANONICAL_REPO, decodeId } from "../preview/resolve.ts";

export interface ChatBody {
  message: string;
  conversationId?: string;
  pageContext?: PageContext;
}

export interface ResolvedConversation {
  id: string;
  /** Private repos whose preview text this conversation already holds. */
  privateRepos: string[];
}

// Resolve the target conversation: verify ownership of an existing one, or open
// a new row. Returns null if the id was supplied but isn't the caller's.
export async function resolveConversation(userId: string, body: ChatBody): Promise<ResolvedConversation | null> {
  if (body.conversationId) {
    const owned = (await sql`
      SELECT id, private_repos FROM conversations WHERE id = ${body.conversationId} AND user_id = ${userId}
    `) as { id: string; private_repos?: string[] | null }[];
    return owned[0] ? { id: owned[0].id, privateRepos: owned[0].private_repos ?? [] } : null;
  }
  // Pass the RAW object (not JSON.stringify'd) + ::jsonb cast — Bun JSON-encodes
  // the value once for the cast; pre-stringifying double-encodes it into a jsonb
  // string scalar. Matches the jsonb pattern in sync.ts.
  const pc = body.pageContext ?? null;
  const created = (await sql`
    INSERT INTO conversations (user_id, model, page_context, title)
    VALUES (${userId}, ${getModel()}, ${pc}::jsonb, ${body.message.slice(0, 60)})
    RETURNING id
  `) as { id: string }[];
  return { id: created[0].id, privateRepos: [] };
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
