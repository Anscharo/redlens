import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const commitHash = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

const atlasCommit = (() => {
  try {
    return execSync("git -C vendor/next-gen-atlas rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();

const buildTime = new Date().toISOString();

const nodeCount = (() => {
  try {
    return Object.keys(JSON.parse(readFileSync("public/docs.json", "utf-8"))).length;
  } catch {
    return 0;
  }
})();

// Artifact hashes are read from public/manifest.json (emitted by
// scripts/build-manifest.mjs). The frontend compares each fetched JSON's
// sha256 against this map before using it — catches CDN tampering, truncated
// responses, and stale worker caches.
const artifactHashes: Record<string, string> = (() => {
  try {
    const m = JSON.parse(readFileSync("public/manifest.json", "utf-8"));
    const out: Record<string, string> = {};
    for (const [name, info] of Object.entries(m.artifacts ?? {})) {
      out[name] = (info as { sha256: string }).sha256;
    }
    return out;
  } catch {
    return {};
  }
})();

// CF Pages sets CF_PAGES=1 automatically; Railway sets RAILWAY_ENVIRONMENT.
// Both deploy to the domain apex so base is "/". GH Pages lives under /redlens/.
const base =
  process.env.CF_PAGES === "1" || process.env.RAILWAY_ENVIRONMENT
    ? "/"
    : "/redlens/";

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
        name: "RedLens' Sky Atlas",
        short_name: "RedLens",
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
        // Serve index.html for all navigation requests so deep-URL refreshes work offline.
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            // Atlas data JSON files — network-first, 3 s timeout before falling to cache
            urlPattern: /\/(docs|search-index|addresses(?:\.atlas)?|relations|chain-state|glossary|manifest)\.json$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "atlas-data",
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
      __ATLAS_COMMIT__: JSON.stringify(atlasCommit),
      __BUILD_TIME__: JSON.stringify(buildTime),
      __NODE_COUNT__: JSON.stringify(nodeCount),
      __ARTIFACT_HASHES__: JSON.stringify(artifactHashes),
      __CHAT_ENABLED__: JSON.stringify(chatEnabled),
    },
  };
});
