import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'

const commitHash = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() }
  catch { return 'dev' }
})()

const atlasCommit = (() => {
  try { return execSync('git -C vendor/next-gen-atlas rev-parse --short HEAD').toString().trim() }
  catch { return 'unknown' }
})()

const buildTime = new Date().toISOString()

const nodeCount = (() => {
  try { return Object.keys(JSON.parse(readFileSync('public/docs.json', 'utf-8'))).length }
  catch { return 0 }
})()

export default defineConfig({
  base: '/redlens/',
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      scope: '/redlens/',
      registerType: 'autoUpdate',
      manifest: {
        name: "RedLens' Sky Atlas",
        short_name: 'RedLens',
        description: 'Search-first interface for the Sky ecosystem Atlas',
        start_url: '/redlens/',
        scope: '/redlens/',
        display: 'standalone',
        background_color: '#160e0d',
        theme_color: '#160e0d',
        icons: [
          {
            src: '/redlens/icon-SMALL.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // Don't precache large data files — they're handled by runtime caching
        globIgnores: [
          '**/docs.json',
          '**/search-index.json',
          '**/addresses.json',
          '**/chain-state.json',
          '**/atlas-graph.json',
          '**/history/**',
        ],
        runtimeCaching: [
          {
            // Large data files: serve from cache if available, update in background
            urlPattern: /\/(docs|search-index|addresses|chain-state|atlas-graph)\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'atlas-data',
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            // Google Fonts files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __COMMIT_HASH__:  JSON.stringify(commitHash),
    __ATLAS_COMMIT__: JSON.stringify(atlasCommit),
    __BUILD_TIME__:   JSON.stringify(buildTime),
    __NODE_COUNT__:   JSON.stringify(nodeCount),
  },
})
