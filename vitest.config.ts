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
        // Offline one-off eval tooling, not shippable code — explicitly out of
        // coverage even though the include patterns above don't reach it today.
        "scripts/aux/eval-smalltalk-judge.ts",
        // run-thread.mjs moved here from scripts/htmlhist/ (W3-2, directory-moves) — a
        // pure relocation, not new coverage scope. Its only importers (prepare-html-
        // history.mjs, thread-structural.mjs, scripts/prehist/genesis-bridge.mjs) are
        // offline curation CLIs with no vitest coverage, so joining scripts/lib/**/*.mjs
        // would newly fail the changed-line gate on its relocated import lines with
        // 0% coverage it never had (nor needed) at its old path. Its 3 tested siblings
        // (atlas-html/history-identity/ordered-containment) are deliberately NOT
        // excluded — they have real scripts_tests/ coverage already.
        "scripts/lib/run-thread.mjs",
      ],
    },
    // src/server runs under `bun test` (it imports Bun's SQL, absent in node-vitest).
    // scripts/eval/*.test.ts files that import bun:test run under `test:server`,
    // not vitest (eval-verifier-mutations + eval-retrieval-queries).
    // e2e/*.spec.ts are Playwright specs (browser/API against a live deploy).
    // The helper *.test.ts files stay in Vitest so readiness/transport parsing
    // can be exercised without a live deployment.
    // Component tests that need a DOM opt in individually via a `// @vitest-environment jsdom` pragma.
    exclude: [
      ".claude/**",
      "**/node_modules/**",
      "vendor/**",
      "graph-snapshots/**",
      "src/server/**",
      "scripts/eval/eval-verifier-mutations.test.ts",
      "scripts/eval/eval-retrieval-queries.test.ts",
      "e2e/**/*.spec.ts",
    ],
  },
});
