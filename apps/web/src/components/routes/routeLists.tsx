import { Suspense, type ReactNode } from "react";
import { Route, Redirect } from "wouter";
import { ROUTES } from "@/lib/routes";
import { SIMPLE_ROUTES, type RouteCtx } from "../../lib/lazyRoutes";
import { LEGACY_REDIRECTS, LEGACY_REDIRECT_PREFIXES } from "../../lib/legacyRedirects";
import { Loading } from "../Loading";

// These return arrays of <Route> rather than being components: wouter's
// <Switch> matches on the `path` of its (flattened) children, so a component
// wrapping several routes would never match.

/** A lazy page, with the loading state while its chunk arrives. */
export function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

/** The SIMPLE_ROUTES table (see lib/lazyRoutes.tsx), one lazy route per entry. */
export function simpleRoutes(ctx: RouteCtx) {
  return SIMPLE_ROUTES.map(({ path, Component, props }) => (
    <Route key={path} path={path}>
      <LazyPage>
        <Component {...(props ? props(ctx) : {})} />
      </LazyPage>
    </Route>
  ));
}

/** Retired URLs, each redirected to the page that replaced it. */
export function redirectRoutes() {
  return [
    ...LEGACY_REDIRECTS.map(([from, to]) => (
      <Route key={from} path={from}>
        <Redirect to={to} replace />
      </Route>
    )),
    ...LEGACY_REDIRECT_PREFIXES.map((path) => (
      <Route key={path} path={path}>
        {/* wouter names a `:name*` wildcard param literally "tab*" (asterisk
            included), not "tab", so params.tab would drop the tab segment and
            send /library/glossary to bare /reports/crossview. */}
        {(params: { "tab*"?: string }) => (
          <Redirect to={`${ROUTES.REPORTS_CROSSVIEW}${params["tab*"] ? `/${params["tab*"]}` : ""}`} replace />
        )}
      </Route>
    )),
  ];
}
