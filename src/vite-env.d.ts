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
}
