import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { renderOgTags } from "./src/server/og.ts";

const commitHash = (() => {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    if (sha) return sha;
  } catch {
    // No .git — e.g. the Railway Docker build, which COPYs source without history.
  }
  // Fall back to the deploy sha injected as a build-time env var (see the
  // Dockerfile's frontend build stage), mirroring config.ts's appCommit
  // fallback chain. Short-formed to match the `--short` style above.
  const envSha =
    process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.APP_COMMIT ?? process.env.GIT_COMMIT ?? process.env.SOURCE_COMMIT ?? "";
  return envSha ? envSha.slice(0, 7) : "dev";
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


// The app is served from the domain root ("/") on Railway. GitHub Pages is now
// only a redirect stub (gh-pages-redirect/), so there is no longer a base-path
// variant to opt into.
const base = "/";

export default defineConfig(() => {
  // Login-gated features (auth/profile button, saved Collections) and the chat
  // widget all need the Bun /api backend, which only exists on Railway (and
  // locally via the dev proxy). Two build flags:
  //   VITE_USERS_ENABLED=1 → login-required UI (profile button, save-collection)
  //   VITE_CHAT_ENABLED=1  → the chat widget
  // Chat needs a logged-in session, so chat is AND-gated by users: enabling chat
  // without users leaves chat off. Both default off everywhere (GH Pages, CF
  // Pages, Railway, dev) — a missing var never breaks the build.
  const truthy = (v: string | undefined) => v === "1" || v === "true";
  const usersEnabled = truthy(process.env.VITE_USERS_ENABLED);
  const chatEnabled = truthy(process.env.VITE_CHAT_ENABLED) && usersEnabled;

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
        // PostHog analytics proxy — route /z to the Bun server so dev exercises the
        // real IP-stripping path (src/server/posthog-proxy.ts), same as prod.
        "/z": {
          target: `http://localhost:${process.env.API_PORT ?? 3000}`,
          changeOrigin: true,
        },
      },
      // Don't watch the atlas submodule, caches, or generated history — they
      // churn on builds and would trigger noisy dev reloads. `history-decisions.json`
      // is ignored because the curation page WRITES it on ⤒ save; otherwise Vite
      // full-reloads the page mid-curation and drops the decided state. Only that one
      // file is ignored — the other history-*.json (queue, auto-decisions, proposals)
      // must still trigger HMR so a `htmlhist:curate` rebuild shows up in dev.
      watch: {
        ignored: ["**/vendor/next-gen-atlas/**", "**/.cache/**", "**/public/history/**", "**/public/history-decisions.json"],
      },
    },
  plugins: [
    {
      // Dev only: substitute window.__ATLAS_SHA__ in index.html from the local
      // public/docs.json atlasCommit (Vite serves index.html in dev, not the Bun
      // injector). The /api proxy forwards /api/atlas/* to Bun, whose bundle root
      // is public/atlas — so dev exercises the real per-sha serving path. In build
      // the placeholder is left intact for the Bun server to replace at serve time.
      name: "inject-atlas-sha-dev",
      apply: "serve",
      transformIndexHtml(html, ctx) {
        let sha = "";
        let docNodes: Record<string, { id: string; doc_no: string; title: string; type: string; content: string }> = {};
        try {
          const parsed = JSON.parse(readFileSync("public/docs.json", "utf8"));
          sha = parsed.atlasCommit ?? "";
          docNodes = parsed.nodes ?? {};
        } catch {
          /* artifacts not built yet — empty sha → flat BASE_URL fallback */
        }
        // Mirror the Bun server's per-request OG injection so dev unfurls the
        // same way. ctx.originalUrl is the requested path+query; resolve ?id=
        // (UUID or doc_no) against the local docs.json.
        const reqUrl = new URL(ctx.originalUrl ?? "/", "http://localhost");
        const byDocNo = new Map(Object.values(docNodes).map((n) => [n.doc_no, n]));
        const ogTags = renderOgTags({
          pathname: reqUrl.pathname,
          searchParams: reqUrl.searchParams,
          origin: reqUrl.origin,
          lookup: (idOrDocNo) => docNodes[idOrDocNo] ?? byDocNo.get(idOrDocNo),
        });
        // Dev has no Bun-served HTML, so substitute the login flag here too. The
        // real JWT-secret check lives server-side; in dev the build flag is a
        // good-enough proxy (dev.mjs forwards both together).
        //
        // Provider list: mirror the server's credential-based gating off the same
        // env vars (dev.mjs forwards them) so a single-provider dev setup renders a
        // single button; default to both when usersEnabled but nothing configured.
        const has = (k: string) => (process.env[k] ?? "") !== "";
        const devProviders = !usersEnabled
          ? []
          : (() => {
              const p: string[] = [];
              if (has("GITHUB_CLIENT_ID") && has("GITHUB_CLIENT_SECRET")) p.push("github");
              if (has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET")) p.push("google");
              return p; // empty = no provider configured → no buttons (matches prod)
            })();
        return html
          .replaceAll("{{ATLAS_SHA}}", sha)
          .replaceAll("{{USERS_ENABLED}}", String(usersEnabled))
          .replaceAll("{{CHAT_ENABLED}}", String(chatEnabled))
          .replaceAll("{{AUTH_PROVIDERS}}", devProviders.join(","))
          .replaceAll("{{OG_TAGS}}", ogTags);
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
        // Inline the workbox runtime into sw.js instead of emitting a separate
        // /workbox-<hash>.js that sw.js importScripts()es. The update algorithm
        // re-fetches an installed worker's stored import URLs, and every deploy
        // rebuilds dist/ wholesale — so once a hash stops shipping, that URL
        // 404s (index.ts serves a clean 404 for it by design) and the worker can
        // never update again. No import, no such failure.
        inlineWorkboxRuntime: true,
        // Drop precaches left by superseded builds rather than accumulating them.
        cleanupOutdatedCaches: true,
        // Don't precache large/dynamic data files — they're handled by runtime caching.
        // index.html is ALSO excluded on purpose: the built HTML carries an unreplaced
        // `window.__ATLAS_SHA__ = "{{ATLAS_SHA}}"` placeholder that the Bun server fills
        // in per-request (no-cache). If the SW precached it and served it as the
        // navigation response, every load would see the placeholder sha, 404 on
        // /api/atlas/{{ATLAS_SHA}}/…, and reloadOnce() into an infinite reload loop.
        globIgnores: [
          "**/index.html",
          "**/docs.json",
          "**/docs-shallow.json",
          "**/docs-deep.json",
          "**/search-index.json",
          "**/addresses.json",
          "**/addresses.atlas.json",
          "**/relations.json",
          "**/chain-state.json",
          "**/history/**",
        ],
        // navigateFallback disabled (vite-plugin-pwa defaults it to "index.html").
        // Navigations must reach the Bun server, which serves the SPA shell with the
        // live atlas sha injected (src/server/index.ts). A precache-backed
        // NavigationRoute would shadow that with the stale placeholder HTML and loop.
        // Tradeoff: no offline shell launch — the sha lives in the HTML, so a cached
        // shell = a stale sha; can't have both. The JS/CSS chunks stay precached, so a
        // repeat visit is bundle-instant minus one ~1.6 KB no-cache HTML round-trip.
        // Offline read was a nice-to-have; dropping it is deliberate.

        navigateFallback: undefined,
        runtimeCaching: [
          {
            // Immutable per-sha atlas artifacts (/api/atlas/<sha>/<name>.json):
            // bytes never change, so CacheFirst — once cached, never re-fetched.
            // Must precede the small-files rule below (which would otherwise catch
            // .../addresses.atlas.json + .../glossary.json by suffix). Freshness is
            // a NEW url, not a revalidate; maxEntries bounds per-sha accumulation.
            urlPattern: /\/api\/atlas\/[0-9a-f]{40}\/.*\.json$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "atlas-data-immutable",
              expiration: { maxEntries: 40, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Flat, NON-atlas-versioned files (addresses.json, chain-state.json,
            // manifest.json): network-first (fast to fetch, worth having fresh).
            // glossary.json is now sha-keyed → caught by the CacheFirst rule above,
            // so it's deliberately absent here.
            urlPattern: /\/(addresses(?:\.atlas)?|chain-state|manifest)\.json$/,
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
      __USERS_ENABLED__: JSON.stringify(usersEnabled),
      __CHAT_ENABLED__: JSON.stringify(chatEnabled),
      __REPO_URL__: JSON.stringify(repoUrl),
    },
  };
});
