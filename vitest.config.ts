import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // src/server runs under `bun test` (it imports Bun's SQL, absent in node-vitest).
    // e2e/** are Playwright specs (browser/API against a live deploy) — never vitest.
    exclude: [".claude/**", "**/node_modules/**", "vendor/**", "graph-snapshots/**", "src/server/**", "e2e/**"],
    environmentMatchGlobs: [["src/components/**", "jsdom"]],
  },
});
