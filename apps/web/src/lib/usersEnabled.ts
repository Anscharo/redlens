// Are login-gated features (profile menu, saved Collections) actually usable?
//
// Two independent conditions must hold:
//   1. The bundle was BUILT with them — `__USERS_ENABLED__`, a Vite define from
//      VITE_USERS_ENABLED. When false the login code is tree-shaken out entirely.
//   2. The SERVER can mint sessions RIGHT NOW — `window.__USERS_ENABLED__`,
//      injected into index.html at serve time from `config.usersEnabled` (which
//      requires CHAT_JWT_SECRET). This is what stops a login button from showing
//      when a sign-in would fail for lack of a secret.
//
// The runtime flag is absent only on static/no-server hosting (the placeholder
// never gets replaced → the quoted-compare in index.html yields `false`), where
// logins can't work anyway — so treating "not injected" as off is correct.
export function usersEnabled(): boolean {
  if (!__USERS_ENABLED__) return false;
  return window.__USERS_ENABLED__ === true;
}
