# Admin / Palette Editor

A self-contained, hidden admin section for tuning the dark-theme CSS color tokens
in `src/index.css`. URL-only access at `/admin` and `/admin/palette` (no nav link).

## What it does

- Renders every editable color token (`src/index.css :root`) as a clickable swatch.
- Click a swatch → radial color picker (`@uiw/react-color`).
- "Apply" persists overrides to `localStorage` and applies them live via
  `document.documentElement.style.setProperty('--<name>', value)`.
- "Reset" wipes overrides.
- "Copy as CSS" exports a `:root { … }` snippet of changed tokens to paste into
  `src/index.css` and commit (so changes reach all visitors after redeploy).

A tiny inline script in `index.html` re-applies overrides before first paint to
avoid FOUC.

## Persistence shape

```
localStorage["redline-sky-atlas:palette-overrides"] = {
  "v": 1,
  "values": { "bg": "#1a0f0c", "row-hover": "rgba(255, 250, 240, 0.12)", … }
}
```

Keys are token names without the leading `--`.

Schema version is dark-only by design. If/when the eventual light/dark toggle
ships and the editor stays around, bump to `v: 2` with `{ dark: {…}, light: {…} }`.
