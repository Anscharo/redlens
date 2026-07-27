/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const __COMMIT_HASH__: string;
declare const __BUILD_TIME__: string;
declare const __USERS_ENABLED__: boolean;
declare const __CHAT_ENABLED__: boolean;
declare const __REPO_URL__: string;

// Injected into index.html by the Bun server (prod) / a Vite dev plugin (dev):
// the current live atlas sha, used to build the immutable /api/atlas/<sha>/ base.
interface Window {
  __ATLAS_SHA__?: string;
  // Server's real login capability, injected into index.html at serve time
  // (true only when USERS_ENABLED + CHAT_JWT_SECRET are both set). Read via
  // src/lib/usersEnabled.ts, never directly.
  __USERS_ENABLED__?: boolean;
  // CSV of OAuth providers this environment offers ("github", "google", or
  // "github,google"), injected into index.html at serve time. Read via
  // src/lib/authProviders.ts, never directly.
  __AUTH_PROVIDERS__?: string;
}
