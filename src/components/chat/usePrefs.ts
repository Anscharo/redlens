import { useCallback, useEffect, useSyncExternalStore } from "react";

// Chat preferences, persisted per-browser in localStorage and synced across
// components (the NavBar dropdown and the chat panel) via a custom event +
// the cross-tab `storage` event. MVP exposes the two functional switches;
// color-scheme / collapse-tree are a follow-up (FE plan step 9).
export interface ChatPrefs {
  traces: boolean; // show tool-call traces
  reduceMotion: boolean; // disable panel/turn/ember/caret animation
}

const KEY = "rlc-prefs";
const DEFAULTS: ChatPrefs = { traces: false, reduceMotion: false };
const EVENT = "rlc-prefs-change";

// Bumped when the NavBar Account panel dropped the traces/reduceMotion
// switches, so a value persisted under the old (unversioned) schema — from
// when those switches still existed — is treated as stale and ignored rather
// than silently keeping a removed setting in effect forever.
const SCHEMA_VERSION = 2;

function read(): ChatPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const { v, ...parsed } = JSON.parse(raw) as Partial<ChatPrefs> & { v?: number };
    if (v !== SCHEMA_VERSION) return DEFAULTS;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

// Cache the parsed value so getSnapshot returns a stable reference (avoids the
// useSyncExternalStore infinite-loop when JSON.parse yields a fresh object).
let snapshot: ChatPrefs = read();

function subscribe(cb: () => void): () => void {
  const handler = () => {
    snapshot = read();
    cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, () => snapshot, () => DEFAULTS);

  const setPref = useCallback(<K extends keyof ChatPrefs>(key: K, value: ChatPrefs[K]) => {
    const next = { ...read(), [key]: value };
    localStorage.setItem(KEY, JSON.stringify({ ...next, v: SCHEMA_VERSION }));
    snapshot = next;
    window.dispatchEvent(new Event(EVENT));
  }, []);

  // Reflect reduce-motion onto <body> so chat.css can disable animations.
  useEffect(() => {
    document.body.classList.toggle("rlc-nomotion", prefs.reduceMotion);
  }, [prefs.reduceMotion]);

  return { prefs, setPref };
}
