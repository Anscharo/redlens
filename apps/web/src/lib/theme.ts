import { useCallback, useSyncExternalStore } from "react";

// The color-scheme store, persisted per-browser in localStorage and synced
// across components (ThemeButton in the nav) via a custom event + the
// cross-tab `storage` event. Deliberately its OWN store,
// not a field on usePrefs' ChatSettings: usePrefs discards its whole record on
// a SCHEMA_VERSION mismatch (see usePrefs.ts), so a future chat-pref bump would
// silently reset everyone's theme. Theme also has to be readable by the
// pre-paint inline script in index.html before React (or any JSON schema)
// exists, which is why it's stored as a plain string, not JSON.
//
// With NO stored choice, the OS decides: `prefers-color-scheme: light` gets
// SYSTEM_LIGHT_THEME, anything else (including a browser that cannot answer)
// gets DEFAULT_THEME. This reverses the original call — the launch-day worry
// was that following the OS would flip the app under every light-mode visitor
// at once, which was a shipping concern, not a lasting one; matching the
// device is what a visitor expects.
//
// An explicit pick still WINS and is permanent: setTheme writes to storage,
// and anything in storage outranks the OS. Only the untouched state follows
// the system, and it keeps following it — see the media-query listener in
// subscribe() — so a visitor who never opens the picker tracks their OS as it
// changes through the day rather than being pinned by whichever mode they
// happened to first arrive in.

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
    bg: "#141414",
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
/** Which palette an untouched visitor on a light-mode device gets. */
export const SYSTEM_LIGHT_THEME: ThemeId = "light";
const LIGHT_QUERY = "(prefers-color-scheme: light)";
export const THEME_KEY = "redline-sky-atlas:theme";
const EVENT = "redline-sky-atlas:theme-change";

const BY_ID = new Map(THEMES.map((t) => [t.id as string, t]));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value);
}

export function schemeOf(theme: ThemeId): Scheme {
  return BY_ID.get(theme)?.scheme ?? "dark";
}

/** The OS preference, or DEFAULT_THEME where it can't be read. Guarded because
 *  matchMedia is missing in some embedded webviews and in jsdom by default —
 *  and an unsupported query answers `matches: false`, i.e. dark, which is the
 *  right way to fail here anyway. */
function systemTheme(): ThemeId {
  try {
    return window.matchMedia?.(LIGHT_QUERY).matches ? SYSTEM_LIGHT_THEME : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** True when the visitor has never picked a theme, so the OS is in charge. */
function isUnset(): boolean {
  try {
    return !isThemeId(localStorage.getItem(THEME_KEY));
  } catch {
    // Storage blocked (private mode): nothing can have been stored, so the OS
    // is in charge for this session too.
    return true;
  }
}

function read(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    // fall through to the OS
  }
  return systemTheme();
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
  // OS-level flip. Only acted on while the visitor has made no choice of their
  // own — re-checked at fire time rather than captured once, because a pick
  // can happen between subscribing and the OS changing, and a stored pick must
  // never be overridden by the device.
  const media = typeof window.matchMedia === "function" ? window.matchMedia(LIGHT_QUERY) : null;
  const onSystem = () => {
    if (!isUnset()) return;
    snapshot = systemTheme();
    applyTheme(snapshot);
    cb();
  };
  media?.addEventListener?.("change", onSystem);

  window.addEventListener(EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    media?.removeEventListener?.("change", onSystem);
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
