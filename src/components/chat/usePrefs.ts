import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Delivery } from "./api";

// Chat preferences, persisted per-browser in localStorage and synced across
// components (the NavBar dropdown and the chat panel) via a custom event +
// the cross-tab `storage` event. Only reduce-motion has a switch in the UI
// (the Account panel); `traces` is read by ChatPanel but currently has no
// writer, so it sits at its default. color-scheme / collapse-tree are a
// follow-up (FE plan step 9).
//
// ChatPrefs stays boolean-only: ProfileButton.tsx's Account-panel PrefSwitch
// is generic over `keyof ChatPrefs` and renders `prefs[prefKey]` straight
// into `aria-checked`, which only accepts boolean. delivery is a real
// preference (persisted the same way, same record) but not a toggle, so it's
// added on the wider ChatSettings instead — usePrefs() returns ChatSettings
// (a ChatPrefs), so existing ChatPrefs-typed consumers are unaffected.
export interface ChatPrefs {
  traces: boolean; // show tool-call traces
  reduceMotion: boolean; // disable panel/turn/ember/caret animation
}
export interface ChatSettings extends ChatPrefs {
  delivery: Delivery | null; // null = follow the server's env default
}

const KEY = "rlc-prefs";
const DEFAULTS: ChatSettings = { traces: false, reduceMotion: false, delivery: null };
const EVENT = "rlc-prefs-change";

// Bumped to 2 when the NavBar Account panel dropped the traces/reduceMotion
// switches, so a value persisted under the old (unversioned) schema couldn't
// keep a then-removed setting in effect with no way to turn it back off.
//
// Reduce motion has since been restored to that panel, and the version stays
// at 2 deliberately: while the switches were gone `setPref` had no caller at
// all, so no v2 record was ever written. Every stored value in the wild is
// still unversioned and already discarded by the check below — the restored
// switch starts from the default for everyone, and there is no v2 data for a
// further bump to protect against.
const SCHEMA_VERSION = 2;

function read(): ChatSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const { v, ...parsed } = JSON.parse(raw) as Partial<ChatSettings> & { v?: number };
    if (v !== SCHEMA_VERSION) return DEFAULTS;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

// Cache the parsed value so getSnapshot returns a stable reference (avoids the
// useSyncExternalStore infinite-loop when JSON.parse yields a fresh object).
let snapshot: ChatSettings = read();

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

  const setPref = useCallback(<K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) => {
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
