import { useCallback, useSyncExternalStore } from "react";

// The color-scheme store, persisted per-browser in localStorage and synced
// across components (ProfileButton's Account panel, SignedOutMenu) via a
// custom event + the cross-tab `storage` event. Deliberately its OWN store,
// not a field on usePrefs' ChatSettings: usePrefs discards its whole record on
// a SCHEMA_VERSION mismatch (see usePrefs.ts), so a future chat-pref bump would
// silently reset everyone's theme. Theme also has to be readable by the
// pre-paint inline script in index.html before React (or any JSON schema)
// exists, which is why it's stored as a plain string, not JSON.
//
// No system-preference (`prefers-color-scheme`) fallback: defaulting to it
// would flip the app for every light-OS visitor on ship day. Absent or
// unrecognised storage ⇒ DEFAULT_THEME.

/** Every selectable theme, declared once.
 *
 *  ADDING A THEME is three edits, in this order:
 *    1. a `[data-theme="<id>"]` token block in index.css — a FULL override of
 *       every `:root` color token (theme-contrast.test.ts fails otherwise, so
 *       a half-finished palette can't silently inherit dark values),
 *    2. an entry here, with `bg` matching that block's `--bg`,
 *    3. the matching `html[data-theme="<id>"]{--bg:…}` rule in index.html's
 *       anti-flash <style> — theme-html-sync.test.ts asserts 2 and 3 agree.
 *
 *  Nothing else needs touching: the picker renders from this list, and CSS
 *  that only cares light-vs-dark keys off `data-scheme` rather than naming
 *  individual palettes (see `scheme` below). */
export const THEMES = [
  {
    id: "dark",
    label: "Dark",
    hint: "charcoal · the original",
    bg: "#160e0d",
    scheme: "dark",
  },
  {
    id: "giedi",
    label: "Giedi",
    hint: "greyscale · high contrast",
    bg: "#171717",
    scheme: "dark",
  },
  {
    id: "light",
    label: "Light",
    hint: "Sky Eco brand palette",
    bg: "#fafafa",
    scheme: "light",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
/** Light-vs-dark, independent of which palette is selected. Rules that only
 *  care about the DIRECTION of the background (row overlays flipping from
 *  translucent white to black, font-smoothing, chat.css's surface re-binding)
 *  key off `[data-scheme="light"]`, so a new light palette inherits all of
 *  them without adding itself to a dozen selector lists. */
export type Scheme = (typeof THEMES)[number]["scheme"];

export const DEFAULT_THEME: ThemeId = "dark";
export const THEME_KEY = "redline-sky-atlas:theme";
const EVENT = "redline-sky-atlas:theme-change";

const BY_ID = new Map(THEMES.map((t) => [t.id as string, t]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value);
}

export function schemeOf(theme: ThemeId): Scheme {
  return BY_ID.get(theme)?.scheme ?? "dark";
}

function read(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isThemeId(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// Cache the value so getSnapshot returns a stable reference (avoids the
// useSyncExternalStore infinite-loop on a fresh value each read).
let snapshot: ThemeId = read();

/** Idempotent DOM application, callable from the pre-paint script's JS twin
 *  (index.html) and from setTheme below. Sets data-theme for EVERY theme
 *  including the default — feedbackContext.ts reports getAttribute("data-theme")
 *  in bug reports, and an explicit id is more useful than absent; the dark
 *  tokens live on bare :root so this is harmless there. */
export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-scheme", schemeOf(theme));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", BY_ID.get(theme)?.bg ?? THEMES[0].bg);
}

function subscribe(cb: () => void): () => void {
  // Same-tab EVENT: setTheme already updated the module-level `snapshot`
  // directly, so just notify — do NOT re-read storage here. setTheme's
  // localStorage write is try/caught (private mode), so on a failed write a
  // re-read would find nothing, snapshot the OLD theme back over the DOM
  // setTheme just applied, and wedge the picker: it would show the old row
  // selected while the page is visibly on the new one.
  const onLocal = () => cb();
  // Cross-tab storage event: another tab wrote a new value, so re-read.
  const onStorage = () => {
    snapshot = read();
    cb();
  };
  window.addEventListener(EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTheme(): {
  theme: ThemeId;
  scheme: Scheme;
  setTheme: (t: ThemeId) => void;
} {
  const theme = useSyncExternalStore(subscribe, () => snapshot, () => DEFAULT_THEME);

  const setTheme = useCallback((next: ThemeId) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // private mode / storage disabled — still apply for this session
    }
    snapshot = next;
    applyTheme(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { theme, scheme: schemeOf(theme), setTheme };
}
