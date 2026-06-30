---
name: ui-look-and-feel
description: >
  Runbook + knowledge base for visual/styling work on RedLens. Use when the
  user wants UI tweaks, look-and-feel changes, color/theme/palette edits,
  font or typography changes, spacing/layout polish, or asks to "look at the
  app" / screenshot it. Covers the design-token system in src/index.css, the
  /admin/palette live editor and contrast audit, styling conventions, and the
  verified launch-and-screenshot recipe (headless Chrome against Vite).
  Keywords: UI, look and feel, styling, theme, palette, colors, tokens,
  index.css, tailwind, fonts, Inter, screenshot, dev server, admin palette,
  contrast, WCAG
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# ui-look-and-feel

## Where styling lives

- **`src/index.css`** — the single source of truth. All design tokens as CSS
  custom properties in `:root`, all shared component classes (`.atlas-node`,
  `.tree-row`, `.scope-pill`, `.nav-link`, `.badge`, `.atlas-md` prose, …),
  and a small `@layer utilities` block (`.text-tan`, `.text-accent`, …).
- **Tailwind v4** via `@tailwindcss/vite` — there is **no tailwind.config**.
  Components mix Tailwind utility classes with `style={{ color: "var(--tan)" }}`
  inline styles and the component classes above. Match whichever pattern the
  surrounding component uses.
- **`src/components/chat/chat.css`** — chat widget only.
- **Fonts**: **Inter** (body, base weight 500) + **Source Code Pro** (mono,
  `.mono` class), loaded from Google Fonts in `index.html` (non-render-blocking
  `media="print"` swap trick, `display=optional`). *CLAUDE.md's "Lora serif
  body" is stale — Inter is current.* Changing fonts means editing both the
  `index.html` link and the `font-family` stacks in `index.css` (body,
  `.tree-row`, `.atlas-chiclets` repeat the stack inline).
- **Light theme**: `[data-theme="light"]` stub exists in `index.css`, empty —
  tokens fall through to dark.
- **Palette overrides at runtime**: an inline script in `index.html` reads
  `localStorage["redlens:palette-overrides"]` and sets CSS vars before first
  paint. That's what the admin palette "apply" button writes. Permanent changes
  go in `src/index.css`; the admin page's "copy as css" emits the snippet.

## Token taxonomy (`:root` in src/index.css)

| Group | Tokens | Notes |
|---|---|---|
| Surface | `--bg --bg-alt --bg-deep --surface --hover --border` | charcoal w/ red undertone; `--bg-deep` = tree sidebar |
| Brand | `--red --red-dim --accent --error-text` | `--red` is decorative only; `--accent` is the interactive color; `--error-text` is the 4.5:1-safe red |
| Text | `--gray --tan --tan-2 --tan-3 --magenta --terminal-green --lily-green` | `--tan` primary, `-2` secondary, `-3` muted |
| Row overlays | `--row-hover --row-selected --row-focused --atlas-row-selected --row-pulse-flash --row-bar-tint` | translucent whites mixed with per-row `--row-color` via `color-mix()` |
| Graph chrome | `--edge --edge-label-fg --graph-dots` | constellations / ReactFlow |
| Entity palette | `--entity-*` (12) | categorical colors keyed by entity type |
| Depth palette | `--depth-1 … --depth-17` | 6-color jewel cycle (red orange green blue purple magenta) ×2.8 — used by tree chiclets/rows |
| Layout | `--max-prose-width: 68ch` | atlas prose measure |

Contrast annotations in the comments are load-bearing: `--gray`, `--tan-3`,
`--error-text` were specifically tuned to pass WCAG AA (4.5:1) on `--bg` and
`--surface`. Any new foreground color must pass AA too — verify on
`/admin/palette` (ContrastAudit section) or with the `wcag-contrast` package.

## The /admin/palette page

`/admin/palette` (source: `src/admin/`). Click a swatch → color picker →
apply (persists per-browser via localStorage) → "copy as css" for the permanent
`index.css` snippet. Includes a **contrast audit table** and a live
**palette preview**. Token registry: `src/admin/palette-tokens.ts` — **a new
token in index.css should also be registered there** so it's editable/audited.

## Conventions that bite (from CLAUDE.md + the code)

- Semantic HTML; CSS hover over JS; home button is a plain `<a href="/">`.
- Selected atlas node: red left bar (`box-shadow: inset 3px 0 0`), transparent
  background, brighter text. **Never add a background to the selected node.**
- Scroll is `behavior: "instant"`; scroll targets need
  `scroll-margin-top: 64px` (`HEADER_OFFSET` in `src/lib/layout.ts` — the
  `.atlas-node` rule in index.css must stay in sync).
- Base is `/` (served from the domain root); `import.meta.env.BASE_URL` is `"/"`. Root-relative URL strings work directly.
- `prefers-reduced-motion` is respected for the expand animation and row pulse —
  extend that block when adding motion.
- Max ~150 lines/file, max 3 components/file. Shared visual primitives go in
  `index.css` as a class, not copy-pasted inline styles.

## App shell map (what each view is)

`App.tsx` routes: `/` home (search + feature cards) · `/atlas?id=<uuid>` reader
(tree Drawer + virtualized node list + RightPanel tabs) · `/radar[/:slug]`
actor dashboards · `/reports/*` four reports · `/constellations` ReactFlow
graph · `/hints`, `/provenance`, `/admin/*`. Reports + radar use window scroll;
everything else is fixed-shell/inner-scroll (`windowScroll` flag in App.tsx).
Header = `SearchBar.tsx`, status footer = `Footer.tsx`.

## Verified recipe: launch + screenshot (2026-06)

```bash
# pnpm dev needs bun (chat API server); chat is off by default, so Vite alone is fine:
(pnpm exec vite > /tmp/redlens-vite.log 2>&1 & echo $! > /tmp/redlens-dev.pid)
timeout 45 bash -c 'until curl -sf -o /dev/null http://localhost:5173/; do sleep 1; done'

# chromium-cli is NOT installed; headless Chrome is, and works:
google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1440,900 --virtual-time-budget=30000 \
  --screenshot=/tmp/shot.png "http://localhost:5173/"

kill $(cat /tmp/redlens-dev.pid)   # cleanup
```

- Base path is **`/`** — the app is served from the domain root.
- Use `--virtual-time-budget=30000` (60000 right after a cold Vite start —
  on-demand compilation eats the budget). Radar's graph worker takes >12 s of
  virtual time; 12000 captures only the "searching the stars" loading state.
- The worker-driven views (atlas reader, radar) are flaky under virtual time —
  if you get the "searching the stars" loading state, retry with
  `--virtual-time-budget=120000`; tsc/vite-log are clean, it's the harness.
- For close inspection of small elements (chiclets, pills), add
  `--force-device-scale-factor=2` with a narrower `--window-size` (e.g. 900,700).
- Routes worth screenshotting: `/` (home), `/atlas` (reader),
  `/atlas?id=<uuid>` (selected node + right panel),
  `/radar`, `/reports`, `/admin/palette`.
  Pick a content-rich uuid from `public/docs.json`, e.g.
  `86a93dab-2f12-4c3f-9285-bcc4520c851b` (A.1.1 Spirit of the Atlas).
- **If Vite overlays "Failed to resolve import"**, run `pnpm install` — stale
  node_modules after a pulled lockfile change (happened with `wcag-contrast`).
- `pnpm dev` (`scripts/aux/dev.mjs`) spawns bun + vite; it dies with
  `spawn bun ENOENT` if bun isn't on PATH. Set `CHAT_ENABLED=1` only when you
  actually need the chat widget.

## The current aesthetic, in one paragraph

Dark charcoal with a red undertone; tan/cream text (Inter); lowercase mono
chrome (pills, tabs, footer, chiclets) in Source Code Pro; thin `--border`
hairlines; pill-shaped filter buttons; depth-colored underline chiclets next to
doc numbers; selected rows get a red inset bar, never a fill; hover states are
subtle `--hover` / translucent-white mixes with 0.1 s transitions; motion is
minimal (240 ms expand fade, loading twinkle) and reduced-motion-aware.
