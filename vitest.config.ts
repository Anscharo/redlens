import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // vitest doesn't run vite-plugin-pwa, so `virtual:pwa-register/react` (imported
  // by src/hooks/useSWUpdate.ts) is otherwise unresolvable. Point it at a test
  // stub so the hook can load and be mocked. Real values come from the plugin at
  // build time; the stub only needs to satisfy the module graph.
  resolve: {
    alias: {
      "virtual:pwa-register/react": fileURLToPath(new URL("./src/test/pwa-register-stub.ts", import.meta.url)),
    },
  },
  // Mirrors vite.config.ts's build-time constants (declared in src/vite-env.d.ts).
  // vitest doesn't load vite.config.ts, so components that reference them
  // (Footer, analytics, chat auth) would otherwise throw ReferenceError —
  // real values don't matter here, only that they're defined.
  define: {
    __COMMIT_HASH__: JSON.stringify("test"),
    __BUILD_TIME__: JSON.stringify(new Date(0).toISOString()),
    __USERS_ENABLED__: JSON.stringify(false),
    __CHAT_ENABLED__: JSON.stringify(false),
    __REPO_URL__: JSON.stringify("https://github.com/test/test"),
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/vitest",
      include: ["src/**/*.{ts,tsx}", "scripts/lib/**/*.mjs"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/vite-env.d.ts",
        "src/server/migrations/**",
      ],
    },
    // src/server runs under `bun test` (it imports Bun's SQL, absent in node-vitest).
    // scripts/aux/eval-verifier-mutations.test.ts is likewise a bun test (imports
    // bun:test + src/server/indexes) — it runs under `test:server`, not vitest.
    // e2e/** are Playwright specs (browser/API against a live deploy) — never vitest.
    // Component tests that need a DOM opt in individually via a `// @vitest-environment jsdom` pragma.
    exclude: [
      ".claude/**",
      "**/node_modules/**",
      "vendor/**",
      "graph-snapshots/**",
      "src/server/**",
      "scripts/aux/eval-verifier-mutations.test.ts",
      "e2e/**",
    ],
  },
});
