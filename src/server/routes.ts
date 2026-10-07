import { config } from "./config.ts";
import { NOT_FOUND } from "./http.ts";
import { handleAuth } from "./auth.ts";
import { canonicalRedirect } from "./history/canonical.ts";
import { handleChat } from "./chat/chat.ts";
import { handleConversations, handleSharedConversationCollection } from "./chat/conversations.ts";
import { handleCollections, handleSharedCollection } from "./collections.ts";
import { handleCollectionSummary } from "./collection-summary.ts";
import { handleFeedback } from "./feedback.ts";
import { handleUsage } from "./rate-limit.ts";
import { handleHistory, handleHistoryBatch } from "./history/history.ts";
import { handleBalances } from "./balances/balances.ts";
import { handleChainState } from "./chain-state.ts";
import { handleForumTopics } from "./forum.ts";
import { handleReportsSearch } from "./reports-search.ts";
import { handleSemanticSearch } from "./search-semantic.ts";
import { handleModCounts } from "./history/mod-counts.ts";
import { handleModTimeline } from "./history/mod-timeline.ts";
import { handleVoteEvidence } from "./vote-evidence/store.ts";

export type RouteHandler = (req: Request) => Response | Promise<Response>;

// Feature gate declared next to the handler it guards. The flag is a thunk
// because config is mutable (tests flip it) and buildRoutes() runs once at
// boot. A gated route that is off answers 404, never a hint it exists.
export function gated(enabled: () => boolean, handler: RouteHandler): RouteHandler {
  return (req) => (enabled() ? handler(req) : NOT_FOUND());
}

const usersOn = () => config.usersEnabled;
const chatOn = () => config.chatEnabled;

// Static segments win over the `:id` param route.
const HISTORY_ROUTES = {
  "/api/history/batch": { POST: (req: Request) => handleHistoryBatch(req) },
  "/api/history/mod-counts": () => handleModCounts(),
  "/api/history/mod-timeline": (req: Request) => handleModTimeline(req),
  "/api/history/:id": (req: Request) => handleHistory(req, new URL(req.url).pathname),
};

// Ungated reads: the reader shows these to everyone, signed in or not.
const PUBLIC_ROUTES = {
  "/api/balances": { GET: (req: Request) => handleBalances(req), POST: (req: Request) => handleBalances(req) },
  "/api/chain-state": () => handleChainState(),
  "/api/forum-topics": (req: Request) => handleForumTopics(req),
  "/api/reports/search": (req: Request) => handleReportsSearch(req),
  // An unconfigured deployment answers `available: false` rather than 404 so
  // the UI can say why the lane is missing.
  "/api/search/semantic": (req: Request) => handleSemanticSearch(req),
  "/api/vote-evidence": () => handleVoteEvidence(),
};

function usersRoutes() {
  // OAuth needs the canonical host (registered callback, host-only state cookie),
  // so the redirect runs outside the gate, whether or not logins are enabled.
  const auth = gated(usersOn, (req) => handleAuth(req, new URL(req.url).pathname));
  const collections = gated(usersOn, handleCollections);
  return {
    "/api/auth/*": (req: Request) => canonicalRedirect(req) ?? auth(req),
    // Public share-link read, declared before the auth-gated :id routes.
    "/api/collections/:id/shared": gated(usersOn, handleSharedCollection),
    "/api/collections/:id/summary": gated(usersOn, handleCollectionSummary),
    "/api/collections": collections,
    "/api/collections/:id": collections,
  };
}

function chatRoutes() {
  const conversations = gated(chatOn, handleConversations);
  return {
    "/api/chat": gated(chatOn, handleChat),
    "/api/usage": gated(chatOn, handleUsage),
    "/api/chat/conversations": conversations,
    "/api/chat/conversations/:id": conversations,
    "/api/chat/conversations/:id/collection": conversations,
    "/api/chat/conversations/:id/shared": gated(chatOn, handleSharedConversationCollection),
  };
}

// Bun's `routes` table: dynamic :id / wildcard patterns that handleRequest does
// not reproduce. A function so each entry's gating is assertable without a
// socket. These match before `fetch` for every method, so none sees the CORS
// preflight; they are same-origin routes. Users routes need usersEnabled; chat
// routes also need chatEnabled.
export function buildRoutes() {
  return {
    ...HISTORY_ROUTES,
    ...PUBLIC_ROUTES,
    ...usersRoutes(),
    ...chatRoutes(),
    /* v8 ignore start -- request glue; handleFeedback is unit-tested directly in feedback.test.ts */
    "/api/feedback": gated(() => config.feedbackEnabled, handleFeedback),
    /* v8 ignore stop */
  };
}
