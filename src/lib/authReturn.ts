// Post-login return handling. OAuth is a full-page round-trip whose server
// callback always lands the browser back at the app root ("/"), so any page the
// user was on — and any transient UI they had open — is lost. We bridge it with
// two per-tab sessionStorage keys: one records where to come back to, the other
// notes that a save-collection modal was mid-flight so it can reopen on return.
//
// sessionStorage (not localStorage) on purpose: the flow stays in one tab, so it
// survives the navigation, but it never leaks a stale destination into a future
// tab. Every read consumes (clears) its key so a value is used at most once.

const RETURN_KEY = "redline:auth-return";
const RESUME_SAVE_KEY = "redline:auth-resume-save";

function canUse(): boolean {
  return typeof sessionStorage !== "undefined";
}

// Record the current location right before kicking off an OAuth redirect.
export function stashAuthReturn(pathWithSearch: string): void {
  if (!canUse()) return;
  try {
    sessionStorage.setItem(RETURN_KEY, pathWithSearch);
  } catch {
    // private mode / quota — a missed return path is a soft degradation, not a bug
  }
}

// Read + clear the stashed return path. Returns null when there's nothing to
// restore (no prior sign-in this tab, or already consumed).
export function takeAuthReturn(): string | null {
  if (!canUse()) return null;
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    if (v) sessionStorage.removeItem(RETURN_KEY);
    return v;
  } catch {
    return null;
  }
}

// Mark that sign-in began from the save-collection modal, so it reopens post-login.
export function stashResumeSave(): void {
  if (!canUse()) return;
  try {
    sessionStorage.setItem(RESUME_SAVE_KEY, "1");
  } catch {
    // ignore — reopening is a nicety, not required for the save to work
  }
}

// Read + clear the resume-save flag.
export function takeResumeSave(): boolean {
  if (!canUse()) return false;
  try {
    const v = sessionStorage.getItem(RESUME_SAVE_KEY) === "1";
    if (v) sessionStorage.removeItem(RESUME_SAVE_KEY);
    return v;
  } catch {
    return false;
  }
}

// Consume the stashed return path and, if it differs from where the OAuth
// callback dropped us, restore it before React mounts — so the router reads
// the restored location and there's no flash of the app root. No-ops when the
// stash matches the current location. Called once at startup from main.tsx.
//
// A /preview/... destination needs a FULL navigation, not an in-place rewrite:
// the OAuth callback always lands on the live-app root, which has already
// rendered <App/> under Root() — a history.replaceState there just relabels
// the URL bar, it never mounts PreviewGate. window.location.replace() reloads
// the page (now carrying the fresh session cookie) so the gate mounts and its
// access check re-runs — the "single login, straight into the preview" path.
export function restoreAuthReturn(): void {
  if (typeof window === "undefined") return;
  const dest = takeAuthReturn();
  if (!dest) return;

  const baseNoSlash = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (dest.startsWith(`${baseNoSlash}/preview/`)) {
    window.location.replace(dest);
    return;
  }

  const current = window.location.pathname + window.location.search;
  if (dest === current) return;
  try {
    window.history.replaceState(null, "", dest);
  } catch {
    // ignore — worst case the user stays on the app root, still signed in
  }
}
