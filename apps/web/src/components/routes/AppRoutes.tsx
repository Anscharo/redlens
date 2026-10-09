import { lazy } from "react";
import { Switch, Route } from "wouter";
import { ROUTES } from "@/lib/routes";
import { SharedCollectionOpener, AdminEntry, lazyRetry } from "../../lib/lazyRoutes";
import { RADAR_ACTOR_ROUTE, RadarActorRoute } from "../../lib/radarRoute";
import { useDataSource } from "../../lib/dataSource";
import { chatEnabled } from "../../lib/chatEnabled";
import type { SearchInput } from "../../hooks/useSearchInput";
import { HomeRoute, AtlasRoute, SearchHintsRoute } from "./pageRoutes";
import { LazyPage, simpleRoutes, redirectRoutes } from "./routeLists";

// Deliberately NOT in lib/lazyRoutes.tsx: this stays local to this file, right
// next to the __CHAT_ENABLED__ guard it's only ever rendered behind, so the
// guard's dead-code-elimination reasoning isn't disturbed by crossing a module
// boundary. The chunk itself is still EMITTED in chat-off builds (this
// unconditional lazy() keeps the dynamic import reachable for Rollup), but
// nothing ever fetches it: the route is unregistered and the widget unmounted.
// Runtime isolation is the guarantee.
const ConversationsPage = lazy(() =>
  lazyRetry(() => import("../conversations/ConversationsPage")).then((m) => ({
    default: m.ConversationsPage,
  })),
);

export interface AppRoutesProps {
  /** The search box's state, which the home route renders results from and the report routes filter by. */
  search: SearchInput;
  /** Opens the tree drawer from the reader. */
  onOpenTree: () => void;
}

/** Every page route. The first match wins, so order matters. */
export function AppRoutes({ search, onOpenTree }: AppRoutesProps) {
  const { preview } = useDataSource();
  return (
    <Switch>
      <Route path={ROUTES.HOME}><HomeRoute search={search} /></Route>
      <Route path={ROUTES.ATLAS}><AtlasRoute onOpenTree={onOpenTree} /></Route>
      {simpleRoutes({ query: search.query, mode: search.activeMode })}
      <Route path={RADAR_ACTOR_ROUTE}>
        {(params: { slug: string; page?: string }) => <RadarActorRoute {...params} query={search.query} />}
      </Route>
      <Route path={ROUTES.SEARCH_HINTS}><SearchHintsRoute /></Route>
      {redirectRoutes()}
      <Route path={ROUTES.SHARED_COLLECTION}>
        {(params: { id: string }) => <LazyPage><SharedCollectionOpener id={params.id} /></LazyPage>}
      </Route>
      {/* __CHAT_ENABLED__ (bare, build-time define) MUST stay the outer
          guard here: it's what lets the minifier prove this whole render
          branch dead and strip it out of chat-off builds (the
          ConversationsPage chunk is still emitted, see the lazy() note above,
          but never fetched). chatEnabled() alone is a function call the
          minifier can't evaluate at build time, so chat would ship even when
          disabled. Do not "simplify" this to chatEnabled() alone.
          `!preview` is also load-bearing: ConversationsPage calls the
          non-optional useChatOpen(), and the preview shell (PreviewGate.tsx)
          mounts <App/> without a ChatOpenProvider, the same reasoning as the
          ProfileButton `!preview` guard. The chat widget's links to it leave
          the preview (ConversationsLink). */}
      {__CHAT_ENABLED__ && chatEnabled() && !preview && (
        <Route path={ROUTES.CONVERSATIONS}>
          <LazyPage><ConversationsPage /></LazyPage>
        </Route>
      )}
      <Route path="/admin/:rest*">
        <LazyPage><AdminEntry /></LazyPage>
      </Route>
    </Switch>
  );
}
