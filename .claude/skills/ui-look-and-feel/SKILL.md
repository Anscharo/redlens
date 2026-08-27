---
name: ui-look-and-feel
description: >
  Runbook + knowledge base for visual/styling work on SAbR. Use when the
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
- **Themes — two axes on `<html>`, both set by `apps/web/src/lib/theme.ts`**:
  `data-theme` = WHICH palette (`dark` | `giedi` | `light` | …),
  `data-scheme` = light-vs-dark. Dark is the default and lives on bare `:root`;
  every other theme is a **full** token override in a `[data-theme="<id>"]`
  block. Rules whose meaning merely flips with the background live in one
  `[data-scheme="light"]` section ("Light-scheme structural overrides") — row
  overlays go translucent-white → black at lower alpha, `--row-bar-tint`,
  font-smoothing (`antialiased` is a light-on-dark tuning), pill outlines that
  were drawn with *text* tokens, and the whole of `chat.css`'s light block. A
  new light palette inherits all of those for free.
  A theme may also define tokens that exist in NO other block (`giedi` has
  `--selected-hint`, `--selected-title`, `--node-title`). Consumers read those
  as `var(--token, <the normal value>)`, so every other palette falls through
  untouched — that is the opt-out slot for a palette whose ramp is too loud for
  some job. The completeness test only walks `:root`, so it won't see them;
  assert them in the giedi-specific describes in `theme-contrast.test.ts`.
  **Adding a theme** = a token block in `index.css` + an entry in the `THEMES`
  registry in `lib/theme.ts` + the `html[data-theme="<id>"]{--bg:…}` rule in
  `index.html`'s anti-flash `<style>`; the registry's doc comment spells this
  out and `theme-html-sync.test.ts` fails if the last two drift.
  **Adding a colour token means adding it to EVERY theme block** —
  `admin/theme-contrast.test.ts` parses `index.css` and fails on a missing
  token or an `AUDIT_PAIRS` pair below AA (3:1 for the focus ring). The picker
  is `components/chat/ThemePicker.tsx`, in both the signed-in and signed-out
  nav menus.
- **Palette overrides at runtime**: an inline script in `index.html` reads
  `localStorage["redlens:palette-overrides"]` and sets CSS vars before first
  paint. That's what the admin palette "apply" button writes. Permanent changes
  go in `src/index.css`; the admin page's "copy as css" emits the snippet.

## Token taxonomy (`:root` in src/index.css)

| Group | Tokens | Notes |
|---|---|---|
| Surface | `--bg --bg-alt --bg-deep --surface --hover --border --border-muted` | charcoal w/ red undertone; `--bg-deep` = tree sidebar |
| Brand | `--red --red-dim --accent --error-text` | `--red` is decorative only; `--accent` is the interactive color; `--error-text` is the 4.5:1-safe red |
| Text | `--gray --tan --tan-2 --tan-3 --magenta --terminal-green --lily-green` | `--tan` primary, `-2` secondary, `-3` muted |
| Row overlays | `--row-hover --row-selected --row-focused --row-pulse-flash --row-bar-tint` | translucent whites mixed with per-row `--row-color` via `color-mix()` |
| Selected doc | `--atlas-row-selected` | the reader's selected-node fill. Per-palette DIRECTION: the colour themes lift it off `--bg-deep`, `giedi` sinks it to black |
| CrossView | `--chunk-fill` | treemap ramp source, mixed into `--surface` under a `--tan-2` label — pick it against that label, never `--red` |
| Entity palette | `--entity-*` (14) | categorical colors keyed by entity type |
| Depth palette | `--depth-1 … --depth-17` | 6-color jewel cycle (red orange green blue purple magenta) ×2.8 — used by tree chiclets/rows |
| Layout | `--max-prose-width: 90ch` | atlas prose measure |

Contrast annotations in the comments are load-bearing: `--gray`, `--tan-3`,
`--error-text` were specifically tuned to pass WCAG AA (4.5:1) on `--bg` and
`--surface`. Any new foreground color must pass AA too — verify on
`/admin/palette` (ContrastAudit section) or with the `wcag-contrast` package.

## Before you finish any visual change: check every theme

There are three colour schemes. A change reviewed in one has been reviewed in
one third of the app.

```bash
pnpm exec vitest run apps/web/src/admin/     # the whole theme gate, ~1s
```

Four things it holds, and the failure each one prevents:

| Test | Prevents |
|---|---|
| every audited token is a literal hex per theme | a `var()`/`color-mix()` silently returning a null ratio instead of failing |
| all `AUDIT_PAIRS` × every theme meet AA (3:1 for the focus ring) | shipping a palette nobody can read |
| every `:root` colour token exists in every theme | a new token silently inheriting the dark value forever |
| every `THEMES` registry id has a CSS block, and vice versa | a theme appearing in the picker that falls through to dark under a light-sounding name |
| no component hardcodes a colour | a literal that looks right in one theme and vanishes in another — the contrast test cannot see these, it only parses `index.css` |

**Adding a colour is therefore three steps, not one:** add the token to
`:root`, give it a value in EVERY `[data-theme]` block, and — if it is a
foreground — add an `AUDIT_PAIRS` entry in `admin/contrast.ts` against `bg`,
`surface` and `bg-deep`. Dark's worst-case surface is its LIGHTEST (`--surface`)
and light's is its DARKEST (`--bg-deep`); neither theme's worst case is covered
by the other's pairs.

**Never hand-pick a colour to clear AA.** Search for it — hold hue fixed and
sweep lightness/chroma in OKLCH until the ratio clears, which finds the most
saturated value that still passes rather than the first dull one that does.
OKLCH, not HSL: equal OKLab lightness means equal *perceived* lightness across
hues, so a set built that way actually looks like one family. HSL does not —
an HSL yellow at `L=50%` is far brighter than an HSL violet at `L=50%`.

**Screenshots do not substitute for the gate**, and the gate does not substitute
for screenshots. The gate catches unreadable; only looking catches ugly. Do
both, and shoot every theme (see the recipe below — seed
`localStorage["redline-sky-atlas:theme"]` before load so the pre-paint path runs).

## The /admin/palette page

`/admin/palette` (source: `src/admin/`). Click a swatch → color picker →
apply (persists per-browser via localStorage) → "copy as css" for the permanent
`index.css` snippet. Includes a **contrast audit table** and a live
**palette preview**. Token registry: `src/admin/palette-tokens.ts` — **a new
token in index.css should also be registered there** so it's editable/audited.

## Conventions that bite (from CLAUDE.md + the code)

- Semantic HTML; CSS hover over JS; home button is a plain `<a href="/">`.
- Selected atlas node: red left bar (`box-shadow: inset 3px 0 0`), brighter
  text, and a subtle muted-red `--bg` fill against the deep reader/sidebar
  `--bg-deep`. (The old "never add a background to the selected node" rule was
  reversed once the reader went deep — the soft `--bg` tint is now the marker.)
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
actor dashboards · `/reports/*` four reports · `/hints`, `/provenance`,
`/admin/*`. Reports + radar use window scroll;
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
