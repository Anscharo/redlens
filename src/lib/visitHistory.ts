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

// The current page's /preview/<id> router-base segment, or "" when live / no DOM.
// Capture sites pass BASE-RELATIVE app paths (atlasHref(id) → /atlas?id=X), which
// are identical in preview and live; reading the real URL (the same signal
// main.tsx routes on) lets recordVisit prefix preview visits centrally, without
// threading the DataSource context into every tracking hook.
function previewPrefix(): string {
  if (typeof window === "undefined") return "";
  const base = import.meta.env.BASE_URL.replace(/\/$/, ""); // usually "" (root)
  const rel = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length)
    : window.location.pathname;
  const m = rel.match(PREVIEW_RE);
  return m ? m[0] : "";
}

// A leading atlas-PR-preview segment: /preview/<id>. Previews mount the SAME App
// on the SAME origin under this router base (see main.tsx), and IndexedDB is
// per-origin — so we keep this prefix on stored paths to separate preview visits
// from live ones. productForPath already maps /preview* → "preview", so no
// kindForPath change is needed once the prefix is retained.
const PREVIEW_RE = /^\/preview\/[^/]+/;

// Canonicalize a route to its identity form so the same target always groups
// into one row. Drops incidental query/hash (?view, ?split, #frag) but KEEPS the
// per-route identity param: `id` on /atlas, normalized `q` on the home/search
// route. An optional leading /preview/<id> prefix is preserved verbatim; the
// remainder is canonicalized as usual (so /preview/<id>/atlas?id=X keeps its id).
export function canonicalPath(raw: string): string {
  const previewMatch = raw.match(PREVIEW_RE);
  if (previewMatch) {
    const prefix = previewMatch[0];
    const rest = raw.slice(prefix.length) || "/";
    return prefix + canonicalizeApp(rest);
  }
  return canonicalizeApp(raw);
}

function canonicalizeApp(raw: string): string {
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

// Which product surface a stored path belongs to. Wraps productForPath but adds
// the one case it doesn't cover: the home route carrying a `q` param is a search.
// A /preview/<id>/… path resolves to "preview" (productForPath handles the prefix).
export function kindForPath(path: string): Product {
  if (PREVIEW_RE.test(path)) return "preview";
  const { pathname, params } = splitPath(path);
  if ((pathname === "/" || pathname === "") && params.get("q")) return "search";
  return productForPath(pathname);
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

async function refresh(): Promise<void> {
  snapshot = await idb.getAll<VisitEvent>();
  for (const l of listeners) l();
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
 */
export async function recordVisit(input: { path: string; label: string }): Promise<void> {
  // Prepend the /preview/<id> router base when the current page is a preview, so
  // preview visits get their own path (and kind "preview") and never collide with
  // live ones in the per-origin IndexedDB store.
  const path = canonicalPath(previewPrefix() + input.path);
  const now = Date.now();
  const prev = lastRecorded.get(path);
  if (prev !== undefined && now - prev < DEDUPE_MS) return;
  lastRecorded.set(path, now);

  await idb.add<VisitEvent>({ path, label: input.label, at: now });

  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    await prune(now);
  }
  if (hydrated) await refresh();
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
