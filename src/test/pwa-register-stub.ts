// Test-only stand-in for Vite's `virtual:pwa-register/react` module.
// vitest doesn't load vite.config.ts, so vite-plugin-pwa never registers the
// virtual module and its colon-prefixed specifier is unresolvable under the
// test bundler. vitest.config.ts aliases the specifier to this file so hooks
// that import `useRegisterSW` (useSWUpdate) can load and be `vi.mock`ed.
//
// The default export here is inert: it returns the real hook's shape but never
// fires callbacks, so unrelated tests that transitively import a PWA-aware
// component don't crash. Tests that actually exercise useSWUpdate override this
// with `vi.mock("virtual:pwa-register/react", ...)`.
import type { Dispatch, SetStateAction } from "react";

type RegisterSWOptions = {
  onNeedRefresh?: () => void;
  onRegisteredSW?: (swScriptUrl: string, registration?: ServiceWorkerRegistration) => void;
  onOfflineReady?: () => void;
};

const noopState = <T,>(value: T): [T, Dispatch<SetStateAction<T>>] => [value, () => {}];

export function useRegisterSW(_options: RegisterSWOptions = {}) {
  return {
    needRefresh: noopState(false),
    offlineReady: noopState(false),
    updateServiceWorker: async (_reloadPage?: boolean) => {},
  };
}
