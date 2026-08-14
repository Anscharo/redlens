import { useSyncExternalStore } from "react";
import * as idb from "./idb";
import { productForPath, type Product } from "./productArea";

// Append-only, browser-local log of what the user visits (docs, reports, radar
// actors, searches). Read UI: /history (src/components/visits/), which derives
// its four cards from this log via src/lib/historyIndex.ts. Stored in IndexedDB
// (see idb.ts): an append-only log grows unbounded, which localStorage's
// synchronous ~5 MB cap can't hold, and IndexedDB is async + indexable. Fully
// anonymous and never leaves the browser (no server, no PostHog, no PII) —
// same posture as src/lib/analytics.ts.
//
// Minimal per-row schema `{ path, label, params?, at }`: `kind` is derived from
// `path` (kindForPath) and grouping identity IS the canonical `path`, so neither
// needs its own column. `label` is the one field not recoverable from a path (a
// doc UUID → title needs docs.json), so it is cached at visit time. `params` is
// the report/radar filter state (see normalizeParams) — deliberately NOT part of
// the grouping identity, so a report's visit count stays whole no matter how the
// filters were set; the most recent value rides along in the summary so a link
// can restore the last-used filters.

export interface VisitEvent {
  id?: number; // IndexedDB auto-increment key
  path: string; // CANONICAL route — identity (group-by) AND restore link
  label: string; // human title captured at visit time
  params?: string; // normalized filter querystring, no leading "?" (may be absent/"")
  at: number; // epoch ms
}

export interface VisitSummary {
  path: string;
  kind: Product;
  label: string; // most-recent label seen for this path
  params: string; // filters set on the most recent visit ("" when none)
  count: number;
  last: number; // epoch ms of the most recent visit
}

const DEDUPE_MS = 30_000; // ignore a repeat of the same path+params within this window
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

// Longest a single `k=v` pair may be before it is dropped, and the cap on the
// whole normalized string. Guards the open-ended params (an `expanded` row list
// grows with every row the user opens) from bloating a log row that only exists
// to redisplay a handful of filter chips.
const MAX_PARAM_LEN = 120;
const MAX_PARAMS_LEN = 300;

/**
 * Normalize a route's query into the stored `params` form: sorted `k=v` pairs
 * joined by "&", no leading "?". Sorting makes the same filter set compare equal
 * regardless of the order the user set them in; empty values are dropped so
 * "cleared the filter" and "never set it" are the same state.
 */
export function normalizeParams(search: string | URLSearchParams): string {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const pairs: string[] = [];
  let total = 0;
  for (const [k, v] of [...sp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!v) continue;
    const pair = `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    if (pair.length > MAX_PARAM_LEN) continue;
    if (total + pair.length > MAX_PARAMS_LEN) break;
    pairs.push(pair);
    total += pair.length + 1; // +1 for the joining "&"
  }
  return pairs.join("&");
}

/** Restore URL for a stored visit — its path plus whichever filters were set. */
export function visitHref(row: { path: string; params?: string }): string {
  if (!row.params) return row.path;
  return `${row.path}${row.path.includes("?") ? "&" : "?"}${row.params}`;
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
        row.params = e.params ?? "";
      }
    } else {
      byPath.set(e.path, {
        path: e.path,
        kind: kindForPath(e.path),
        label: e.label,
        params: e.params ?? "",
        count: 1,
        last: e.at,
      });
    }
  }
  return [...byPath.values()];
}

// --- reactive snapshot (backs the /history page) ---------------------------

// `loaded` rides in the same object as the events so both change in one atomic
// swap: the /history page needs to tell "the log is empty" from "the first
// IndexedDB read hasn't resolved yet", and two separate stores could disagree
// for a render.
export interface VisitLog {
  events: VisitEvent[];
  loaded: boolean;
}

let snapshot: VisitLog = { events: [], loaded: false };
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

// Full re-read — used only for initial hydration and after clearHistory, NOT per
// write (the log is append-only, so recordVisit appends to snapshot in place).
async function refresh(): Promise<void> {
  snapshot = { events: await idb.getAll<VisitEvent>(), loaded: true };
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

/** Reactive view of the raw event log plus whether the first read has landed. */
export function useVisitLog(): VisitLog {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Reactive view of the raw event log. Returns [] until the first async read. */
export function useVisitHistory(): VisitEvent[] {
  return useVisitLog().events;
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
 * path, drops a repeat of the same path+params within DEDUPE_MS (guards remounts
 * / rapid re-navigation, while still recording a genuine filter change), then
 * opportunistically enforces retention + row cap.
 *
 * `base` is the wouter router base (`useRouter().base`) — `""` on the live atlas,
 * `/preview/<id>` in preview mode. Prepending it keeps preview visits on their own
 * paths (and kind "preview") so they never collide with live ones in the
 * per-origin IndexedDB store. Callers pass base-relative app paths (atlasHref(id)).
 *
 * `params` is the page's filter state (a querystring or URLSearchParams) for
 * routes whose identity excludes the query — reports and radar. It is stored
 * beside the path, never folded into it.
 */
export async function recordVisit(input: {
  path: string;
  label: string;
  base?: string;
  params?: string | URLSearchParams;
}): Promise<void> {
  const path = (input.base ?? "") + canonicalPath(input.path);
  const params = input.params ? normalizeParams(input.params) : "";
  const now = Date.now();
  const dedupeKey = params ? `${path}?${params}` : path;
  const prev = lastRecorded.get(dedupeKey);
  if (prev !== undefined && now - prev < DEDUPE_MS) return;
  lastRecorded.set(dedupeKey, now);

  const event: VisitEvent = { path, label: input.label, at: now };
  if (params) event.params = params;
  await idb.add<VisitEvent>(event);

  if (++writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    await prune(now);
  }
  // Append-only: extend the live snapshot in place rather than re-reading the store.
  if (hydrated) {
    snapshot = { events: [...snapshot.events, event], loaded: snapshot.loaded };
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
