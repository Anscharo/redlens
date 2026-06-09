import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

const commitHash = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

const repoUrl = (() => {
  try {
    return execSync("git remote get-url origin")
      .toString().trim()
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/\.git$/, "");
  } catch {
    return "https://github.com/Anscharo/redlens";
  }
})();

const buildTime = new Date().toISOString();


// Default base is "/". Only GitHub Pages lives under /redlens/ — opt in explicitly.
const base = process.env.GITHUB_PAGES === "1" ? "/redlens/" : "/";

export default defineConfig(() => {
  // The chat widget + auth/profile button need the Bun /api backend, which only
  // exists on Railway (and locally via the dev proxy). They ship DISABLED by
  // default everywhere — GH Pages, CF Pages, Railway, and dev alike — so merging
  // this branch adds nothing user-visible. Flip the bundle on by building with
  // VITE_CHAT_ENABLED=1 (and pair it with the server's CHAT_ENABLED=1). Any other
  // value (or unset) leaves chat off; a missing var never breaks the build.
  const chatEnabled =
    process.env.VITE_CHAT_ENABLED === "1" || process.env.VITE_CHAT_ENABLED === "true";

  return {
    base,
    // Don't wipe the terminal on boot/restart — keeps the Bun server's logs
    // (which run alongside vite in `pnpm dev`) visible.
    clearScreen: false,
    server: {
      // Dev only: proxy /api to the Bun server (src/server/index.ts, :3000) so the
      // chat widget's same-origin fetches reach the backend during `pnpm dev`.
      // In prod the Bun server serves both dist/ and /api on one origin, so no
      // proxy is needed (and base is "/", making BASE_URL + "api/…" === /api/…).
      proxy: {
        "/api": {
          target: `http://localhost:${process.env.API_PORT ?? 3000}`,
          changeOrigin: true,
        },
      },
      // Don't watch the atlas submodule, caches, or generated history — they
      // churn on builds and would trigger noisy dev reloads.
      watch: {
        ignored: ["**/vendor/next-gen-atlas/**", "**/.cache/**", "**/public/history/**"],
      },
    },
  plugins: [
    {
      name: "redirect-root",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (base !== "/" && (req.url === "/" || req.url === base.slice(0, -1))) {
            res.writeHead(307, { Location: base });
            res.end();
            return;
          }
          next();
        });
      },
    },
    tailwindcss(),
    react(),
    VitePWA({
      scope: base,
      // "prompt" — the new SW waits for explicit activation. Avoids the
      // mid-session race where autoUpdate evicts the chunks the live page
      // is still importing (manifests as "Failed to fetch dynamically
      // imported module: …/RadarPage-<hash>.js" until the user reloads).
      registerType: "prompt",
      manifest: {
        name: "Sky Atlas by Redline",
        short_name: "redline-atlas",
        description: "Search-first interface for the Sky ecosystem Atlas",
        start_url: base,
        scope: base,
        display: "standalone",
        background_color: "#160e0d",
        theme_color: "#160e0d",
        icons: [
          {
            src: `${base}icon-SMALL.png`,
            sizes: "28x28",
            type: "image/png",
          },
        ],
      },
      workbox: {
        // Don't precache large/dynamic data files — they're handled by runtime caching
        globIgnores: [
          "**/docs.json",
          "**/search-index.json",
          "**/addresses.json",
          "**/addresses.atlas.json",
          "**/relations.json",
          "**/chain-state.json",
          "**/history/**",
        ],
        // Serve index.html for SPA routes, but not for server endpoints — those
        // must reach the Bun server directly.
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp$/],
        runtimeCaching: [
          {
            // Large atlas files: serve cached version immediately, refresh in background.
            // The SSE "atlas updated ↻" pill tells users when a new version is ready so
            // being one load cycle behind is acceptable.
            urlPattern: /\/(docs|search-index|relations)\.json$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "atlas-data-large",
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Small atlas files: network-first (fast to fetch, worth having fresh values).
            urlPattern: /\/(addresses(?:\.atlas)?|chain-state|glossary|manifest)\.json$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "atlas-data-small",
              networkTimeoutSeconds: 3,
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            // Google Fonts files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
    define: {
      __COMMIT_HASH__: JSON.stringify(commitHash),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __CHAT_ENABLED__: JSON.stringify(chatEnabled),
      __REPO_URL__: JSON.stringify(repoUrl),
    },
  };
});
