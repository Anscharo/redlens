// Is the chat feature actually usable right now? Two independent conditions,
// same shape as usersEnabled() (src/lib/usersEnabled.ts):
//   1. The bundle was BUILT with it — `__CHAT_ENABLED__`, a Vite define from
//      VITE_CHAT_ENABLED (itself AND-gated on VITE_USERS_ENABLED at build
//      time — see vite.config.ts; chat requires a signed-in session). When
//      false the chat widget/route are tree-shaken out entirely.
//   2. The SERVER can serve chat RIGHT NOW — `window.__CHAT_ENABLED__`,
//      injected into index.html at serve time from `config.chatEnabled`.
//
// The runtime flag is absent only on static/no-server hosting (the
// placeholder never gets replaced → the quoted-compare in index.html yields
// `false`), where chat can't work anyway — so treating "not injected" as off
// is correct.
export function chatEnabled(): boolean {
  if (!__CHAT_ENABLED__) return false;
  return window.__CHAT_ENABLED__ === true;
}
