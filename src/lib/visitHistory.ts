import { useSyncExternalStore } from "react";
import * as idb from "./idb";
import { productForPath, type Product } from "./productArea";

// Append-only, browser-local log of what the user visits (docs, reports, radar
// actors, searches) so a future UI can show "most visited". Data capture only —
// there is no read UI yet. Stored in IndexedDB (see idb.ts): an append-only log
// grows unbounded, which localStorage's synchronous ~5 MB cap can't hold, and
// IndexedDB is async + indexable. Fully anonymous and never leaves the browser
// (no server, no PostHog, no PII) — same posture as src/lib/analytics.ts.
//
// Minimal per-row schema `{ path, label, at }`: `kind` is derived from `path`
// (kindForPath) and grouping identity IS the canonical `path`, so neither needs
// its own column. `label` is the one field not recoverable from a path (a doc
// UUID → title needs docs.json), so it is cached at visit time.

export interface VisitEvent {
  id?: number; // IndexedDB auto-increment key
  path: string; // CANONICAL route — identity (group-by) AND restore link
  label: string; // human title captured at visit time
  at: number; // epoch ms
}

export interface VisitSummary {
  path: string;
  kind: Product;
  label: string; // most-recent label seen for this path
  count: number;
  last: number; // epoch ms of the most recent visit
}

const DEDUPE_MS = 30_000; // ignore a repeat of the same path within this window
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // forget visits older than ~180 days
const MAX_ROWS = 5_000; // best-effort soft cap; oldest rows evicted past this (trimToMax isn't atomic)
const PRUNE_EVERY = 20; // amortize retention/cap enforcement across writes

// --- pure helpers (exported for unit tests; no DB, no clock) ---------------

function splitPath(raw: string): { pathname: string; params: URLSearchParams } {
  const noHash = raw.split("#")[0];
  const qIdx = noHash.indexOf("?");
  const pathname = qIdx === -1 ? noHash : noHash.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? "" : noHash.slice(qIdx + 1));
  return { pathname, params };
}

// Canonicalize a route to its identity form so the same target always groups
// into one row. Drops incidental query/hash (?view, ?split, #frag) but KEEPS the
// per-route identity param: `id` on /atlas, normalized `q` on the home/search
// route. Callers pass BASE-RELATIVE app paths (atlasHref(id) → /atlas?id=X);
// recordVisit prepends any /preview/<id> router base separately, so this helper
// stays preview-agnostic.
export function canonicalPath(raw: string): string {
  const { pathname, params } = splitPath(raw);
  if (pathname === "/atlas") {
    const id = params.get("id");
    return id ? `/atlas?id=${id}` : "/atlas";
  }
  if (pathname === "/" || pathname === "") {
    const q = (params.get("q") ?? "").trim().toLowerCase();
    return q ? `/?q=${encodeURIComponent(q)}` : "/";
  }
  return pathname; // /reports/<id>, /radar/<slug> — path segment is the identity
}

// Which product surface a stored path belongs to. productForPath already covers
// every case (incl. /preview/<id>/… → "preview" via its /preview prefix, and / →
// "search"); we only strip the query first so the exact "/" match survives a
// "?q=" suffix on stored search paths.
export function kindForPath(path: string): Product {
  return productForPath(splitPath(path).pathname);
}

// Group events by canonical path into "most visited" rows. Pure — unit-tested
// directly, mirroring recentSearches' mergeRecent.
export function summarize(events: VisitEvent[]): VisitSummary[] {
  const byPath = new Map<string, VisitSummary>();
  for (const e of events) {
    const row = byPath.get(e.path);
    if (row) {
      row.count++;
      if (e.at >= row.last) {
        row.last = e.at;
        row.label = e.label;
      }
    } else {
      byPath.set(e.path, {
        path: e.path,
        kind: kindForPath(e.path),
        label: e.label,
        count: 1,
        last: e.at,
      });
    }
  }
  return [...byPath.values()];
}

// --- reactive snapshot (for a future UI; harmless now) ---------------------

let snapshot: VisitEvent[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

// Full re-read — used only for initial hydration and after clearHistory, NOT per
// write (the log is append-only, so recordVisit appends to snapshot in place).
async function refresh(): Promise<void> {
  snapshot = await idb.getAll<VisitEvent>();
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!hydrated) {
    hydrated = true;
    void refresh();
  }
  return () => listeners.delete(cb);
}

/** Reactive view of the raw event log. Returns [] until the first async read. */
export function useVisitHistory(): VisitEvent[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

// --- writes / queries ------------------------------------------------------

const lastRecorded = new Map<string, number>(); // canonical path → last `at`
let writesSincePrune = PRUNE_EVERY; // prune on the first write of the session

async function prune(now: number): Promise<void> {
  await idb.deleteBefore(now - RETENTION_MS);
  await idb.trimToMax(MAX_ROWS);
}

/**
 * Append one visit. Fire-and-forget — callers don't await. Canonicalizes the
 * path, drops a repeat of the same path within DEDUPE_MS (guards remounts /
 * rapid re-navigation), then opportunistically enforces retention + row cap.
 *
 * `base` is the wouter router base (`useRouter().base`) — `""` on the live atlas,
 * `/preview/<id>` in preview mode. Prepending it keeps preview visits on their own
 * paths (and kind "preview") so they never collide with live ones in the
 * per-origin IndexedDB store. Callers pass base-relative app paths (atlasHref(id)).
 */
export async function recordVisit(input: {
  path: string;
  label: string;
  base?: string;
}): Promise<void> {
  const path = (input.base ?? "") + canonicalPath(input.path);
  const now = Date.now();
  const prev = lastRecorded.get(path);
  if (prev !== undefined && now - prev < DEDUPE_MS) return;
  lastRecorded.set(path, now);

  const event: VisitEvent = { path, label: input.label, at: now };
  await idb.add<VisitEvent>(event);

  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    await prune(now);
  }
  // Append-only: extend the live snapshot in place rather than re-reading the store.
  if (hydrated) {
    snapshot = [...snapshot, event];
    emit();
  }
}

/** Read all events, optionally only those on/after `since`. */
export async function getEvents(opts: { since?: number } = {}): Promise<VisitEvent[]> {
  const events = await idb.getAll<VisitEvent>();
  return opts.since ? events.filter((e) => e.at >= opts.since!) : events;
}

/**
 * "Most visited" — group the log by canonical path, filter by kind/since, sort
 * by visit count (tiebreak most-recent). The query a future UI will call.
 *
 * Preview visits (kind "preview") are excluded by default so atlas-PR review
 * activity never pollutes "most visited"; pass `{ kind: "preview" }` to get them.
 */
export async function topVisited(
  opts: { kind?: Product; n?: number; since?: number } = {},
): Promise<VisitSummary[]> {
  const events = await getEvents({ since: opts.since });
  let rows = summarize(events);
  rows = opts.kind
    ? rows.filter((r) => r.kind === opts.kind)
    : rows.filter((r) => r.kind !== "preview");
  rows.sort((a, b) => b.count - a.count || b.last - a.last);
  return opts.n ? rows.slice(0, opts.n) : rows;
}

/** Wipe the entire log. */
export async function clearHistory(): Promise<void> {
  await idb.clear();
  lastRecorded.clear();
  if (hydrated) await refresh();
}
