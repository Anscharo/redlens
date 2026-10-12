// The event stream of one commit-history walk, and the registry that lets a
// second reader join a walk already running instead of starting another: a
// joiner gets every event so far, then the live tail. One walk per
// (sha, diff base); a walk leaves the registry on its last event.

import type { CommitRecord } from "./commit-walk.ts";

export type CommitStreamError = "unavailable" | "range-failed" | "fetch-failed" | "timeout" | "failed" | "rate-limited";

export type CommitStreamEvent =
  /** Fetching the branch's history; `loaded` of `total` objects when git reports them. */
  | { type: "fetching"; phase?: string; loaded?: number; total?: number }
  /** The branch has `total` commits since its base; the newest `walking` are read. */
  | { type: "range"; total: number; walking: number }
  /** One commit described; `index` 0 is the newest. */
  | { type: "commit"; index: number; commit: CommitRecord }
  | { type: "done"; truncated: boolean }
  | { type: "error"; reason: CommitStreamError };

export type Send = (ev: CommitStreamEvent) => void;

export const isTerminal = (ev: { type: string }): boolean => ev.type === "done" || ev.type === "error";

interface Walk {
  events: CommitStreamEvent[];
  subs: Set<Send>;
}

const walks = new Map<string, Walk>();

export const walkKey = (sha: string, base: string): string => `${sha}:${base}`;

function broadcast(w: Walk, ev: CommitStreamEvent): void {
  for (const s of w.subs) {
    try {
      s(ev);
    } catch {
      /* a subscriber that went away */
    }
  }
}

/** Register a walk and return its emitter. Its last event removes it. */
export function openWalk(key: string): Send {
  const w: Walk = { events: [], subs: new Set() };
  walks.set(key, w);
  return (ev) => {
    w.events.push(ev);
    broadcast(w, ev);
    if (isTerminal(ev) && walks.get(key) === w) walks.delete(key);
  };
}

/** Join a running walk: replay its events so far, then follow it. Null when no
 *  walk is running under `key`. Returns the unsubscribe function. */
export function joinWalk(key: string, send: Send): (() => void) | null {
  const w = walks.get(key);
  if (!w) return null;
  for (const ev of w.events) send(ev);
  w.subs.add(send);
  return () => w.subs.delete(send);
}

/** Keys of walks in progress. */
export function runningWalks(): string[] {
  return [...walks.keys()];
}
