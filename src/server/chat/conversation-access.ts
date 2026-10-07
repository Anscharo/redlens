// Which conversation a chat turn writes to, and what it may still read. A
// conversation that has read a private repo's PR preview (conversations.
// private_repos) holds that repo's text in its persisted rows, so every turn and
// every reopen re-checks the user's live access to each such repo — the same
// fail-closed check the preview reader uses (preview/access.ts) — and such a
// conversation never sends prompt or response text to PostHog.

import { sql } from "../db.ts";
import { validPreviewContext, type PageContext } from "./system-prompt-page.ts";
import { readMeta } from "../preview/cache.ts";
import { getPreviewRow } from "../preview/db.ts";
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

// GitHub repo names are case-insensitive: one spelling per repo keeps the list
// to one entry, and the live check accepts any spelling.
const repoKey = (repo: string) => repo.toLowerCase();

/** The private repo whose preview the page is inside, or null for a public or
 *  canonical one. The page's titles come from that preview's docs, so a turn
 *  asked there holds its text before any tool runs. Read from the bundle on
 *  disk, then the previews row; a lookup that throws is left to the caller. */
async function lookupPagePreview(sha: string): Promise<{ repo: string; private: boolean } | null> {
  const meta = readMeta(sha);
  if (meta) return { repo: meta.repo, private: !!meta.private };
  const row = await getPreviewRow(sha);
  return row ? { repo: row.repo, private: row.private } : null;
}

export async function pagePrivateRepo(
  page: PageContext | undefined,
  lookup: typeof lookupPagePreview = lookupPagePreview,
): Promise<string | null> {
  const sha = pageNamesNonCanonicalPreview(page) ? validPreviewContext(page)?.sha : undefined;
  if (!sha) return null;
  const found = await lookup(sha);
  return found?.private ? repoKey(found.repo) : null;
}

async function recordRepo(convId: string, repo: string): Promise<void> {
  await sql`
    UPDATE conversations SET private_repos = array_append(private_repos, ${repo})
    WHERE id = ${convId} AND NOT (${repo} = ANY(private_repos))
  `;
}

interface ScopeDeps {
  authorize?: (userId: string, repo: string) => Promise<AccessDecision>;
  record?: typeof recordRepo;
  lookup?: typeof lookupPagePreview;
}

const UNAVAILABLE: ScopeDenied = { denied: "access_check_unavailable", status: 503 };

/** The repos this turn must be allowed to read: those the conversation already
 *  holds, plus a private preview the page is inside. A failed lookup denies. */
async function reposInScope(conv: ResolvedConversation, page: PageContext | undefined, lookup?: typeof lookupPagePreview) {
  let pageRepo: string | null;
  try {
    pageRepo = await pagePrivateRepo(page, lookup);
  } catch {
    return UNAVAILABLE;
  }
  const held = new Set(conv.privateRepos.map(repoKey));
  return { held, pageRepo: pageRepo && !held.has(pageRepo) ? pageRepo : null };
}

export async function conversationScope(
  userId: string,
  conv: ResolvedConversation,
  page: PageContext | undefined,
  deps: ScopeDeps = {},
): Promise<ConversationScope | ScopeDenied> {
  const scope = await reposInScope(conv, page, deps.lookup);
  if ("denied" in scope) return scope;
  const { held, pageRepo } = scope;
  const denied = await reauthorizeRepos(userId, pageRepo ? [...held, pageRepo] : [...held], deps.authorize);
  if (denied) return denied;
  const onPrivateAccess = recorder(conv.id, held, deps.record ?? recordRepo);
  if (pageRepo && !(await onPrivateAccess(pageRepo).then(() => true, () => false))) return UNAVAILABLE;
  return { privacyMode: held.size > 0 || pageNamesNonCanonicalPreview(page), onPrivateAccess };
}

/** Records a repo on the conversation once per spelling-insensitive name. */
function recorder(convId: string, held: Set<string>, record: typeof recordRepo) {
  return async (repo: string): Promise<void> => {
    const key = repoKey(repo);
    if (held.has(key)) return;
    await record(convId, key);
    held.add(key);
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
