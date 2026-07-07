import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors vite.config.ts's build-time constants (declared in src/vite-env.d.ts).
  // vitest doesn't load vite.config.ts, so components that reference them
  // (Footer, analytics, chat auth) would otherwise throw ReferenceError —
  // real values don't matter here, only that they're defined.
  define: {
    __COMMIT_HASH__: JSON.stringify("test"),
    __BUILD_TIME__: JSON.stringify(new Date(0).toISOString()),
    __CHAT_ENABLED__: JSON.stringify(false),
    __REPO_URL__: JSON.stringify("https://github.com/test/test"),
  },
  test: {
    // src/server runs under `bun test` (it imports Bun's SQL, absent in node-vitest).
    // e2e/** are Playwright specs (browser/API against a live deploy) — never vitest.
    exclude: [".claude/**", "**/node_modules/**", "vendor/**", "graph-snapshots/**", "src/server/**", "e2e/**"],
    environmentMatchGlobs: [["src/components/**", "jsdom"]],
  },
});
