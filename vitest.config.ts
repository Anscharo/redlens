import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // src/server runs under `bun test` (it imports Bun's SQL, absent in node-vitest).
    exclude: [".claude/**", "**/node_modules/**", "vendor/**", "graph-snapshots/**", "src/server/**"],
    environmentMatchGlobs: [["src/components/**", "jsdom"]],
  },
});
