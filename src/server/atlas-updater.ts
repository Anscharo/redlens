// In-process atlas freshness updater — store-driven (artifact-store phase 4).
// Polls sync_state.atlas_sha from Postgres every ~30s; on drift (or first boot
// before this process has hydrated from the store), reads the published
// artifact set out of atlas_artifacts, writes it to public/, reconstructs
// docs.json from atlas_doc_meta (the one artifact the worker does not publish),
// publishes the per-sha bundle, THEN swaps in-memory indexes and broadcasts.
// No git, no build subprocesses, no Postgres writes — all writes belong to
// the worker.
//
// Failure handling: a hydrate that fails or doesn't converge is retried with
// exponential backoff (never permanently skipped — that risked days of silent
// staleness on the few-times-a-week cadence), and escalates to ERROR logs +
// the freshness "stuck" status after ESCALATE_AFTER consecutive failures.
import { spawn } from "node:child_process";
import { config } from "./config.ts";
import { sql } from "./db.ts";
import { getIndexes, rebuildFromDisk, docRowToNode, writeDocsJson } from "./retrieval/indexes.ts";
import { refreshInPlaceFromDisk } from "./atlas-refresh.ts";
import { broadcastAtlasUpdate } from "./sse.ts";
import { MAIN_STORE, PUBLISHED_ARTIFACTS, publishBundle, pinBundleSha, writeStoredArtifacts } from "./bundle-store.ts";
import { getArtifacts } from "./atlas-artifacts.ts";
import type { AtlasNode, DocMetaRow } from "./retrieval/indexes.ts";

export type Decision = "idle" | "build";

// Pure state transition after an attempted publishBundle() call (unit-tested).
// Encodes the invariant that we never broadcast a sha whose bundle isn't on
// disk: success clears the pending slot and fans out to clients; failure
// parks the sha in pendingPublishSha for the next retry instead.
export function publishOutcome(
  builtSha: string,
  ok: boolean,
): { pendingPublishSha: string | null; broadcast: boolean } {
  return ok ? { pendingPublishSha: null, broadcast: true } : { pendingPublishSha: builtSha, broadcast: false };
}

// Pure retry gate for the top-of-tick publish retry (unit-tested): only when
// no build is in flight and a previous publish attempt is still pending.
export function shouldRetryPublish(s: { building: boolean; pendingPublishSha: string | null }): boolean {
  return !s.building && s.pendingPublishSha !== null;
}

// Pure trigger decision (unit-tested). Builds when there is drift, OR when
// this process has not yet hydrated the live sha from the shared store (the
// deploy-order safety net: live===db on an image-baked atlas would otherwise
// idle forever if the worker has not published). `now`/`nextAttemptAt` (ms
// epoch) gate retries: a failed/non-converged hydrate sets nextAttemptAt into
// the future, so we re-poll cheaply but don't re-fetch until it passes.
// `storeHydratedSha` omitted (tests of the pure fn) means "already hydrated"
// so sha-match still idles; the live loop always passes the field.
export function decide(s: {
  upstream: string | null;
  live: string | null;
  building: boolean;
  now: number;
  nextAttemptAt: number;
  storeHydratedSha?: string | null;
}): Decision {
  if (s.building) return "idle";
  if (!s.upstream) return "idle";
  if (s.now < s.nextAttemptAt) return "idle";
  if (s.upstream === s.live) {
    const needsStore = s.storeHydratedSha !== undefined && s.storeHydratedSha !== s.upstream;
    if (!needsStore) return "idle";
  }
  return "build";
}

// Exponential backoff from the poll interval, capped. failures>=1.
// ATLAS_UPDATE_MAX_BACKOFF_MS is read here (call time), not via config.ts —
// this fn is unit-tested directly (see backoffMs tests in atlas-updater.test.ts),
// and a config.ts field would freeze at config.ts's own first import instead of
// tracking env at call time.
export function backoffMs(failures: number, base: number): number {
  const cap = Number(process.env.ATLAS_UPDATE_MAX_BACKOFF_MS ?? 30 * 60_000);
  return Math.min(base * 2 ** Math.min(failures - 1, 20), cap);
}

// Pure: next value of the divergence clock (unit-tested). Set on first
// divergence from a KNOWN upstream; cleared ONLY on real convergence
// (live === upstream AND the store has been hydrated for that sha); a
// null/unknown upstream preserves the prior value so a transient DB read
// failure can't keep restarting the stuck timer.
//
// `storeHydratedSha` mirrors decide()'s deploy-order safety net: live===db on
// an image-baked atlas with an empty artifact store is NOT converged — the
// process is retrying hydration every tick — so the clock must run, or
// /api/freshness would report "syncing" forever instead of escalating to
// "stuck" past the threshold. Omitted (older callers/tests) means "already
// hydrated", same as decide().
export function nextDivergedSince(
  prev: number | null,
  upstream: string | null,
  live: string | null,
  now: number,
  storeHydratedSha?: string | null,
): number | null {
  if (!upstream) return prev;
  const needsStore = storeHydratedSha !== undefined && storeHydratedSha !== upstream;
  if (live === upstream && !needsStore) return null;
  return prev ?? now;
}

// Loud-log + freshness "stuck" threshold (consecutive failed/non-converged builds).
const ESCALATE_AFTER = config.atlasUpdateEscalateAfter;

// Single source of truth for updater state — read by freshness.ts (to tell a
// benign "syncing" from a genuinely "stuck" updater) and mutated only by the
// tick loop. Folding the retry bookkeeping (nextAttemptAt/failingTarget) in
// here too avoids a second copy in the loop's closure that could silently desync.
export interface UpdaterState {
  building: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  // ms epoch when live first diverged from upstream and hasn't reconverged;
  // null while converged. Drives the stuck alarm.
  divergedSinceMs: number | null;
  lastSuccessMs: number | null;
  // Retry gate: earliest ms epoch for the next build attempt, and the sha that
  // build is backing off on (so a fresh upstream resets the backoff).
  nextAttemptAt: number;
  failingTarget: string | null;
  // Set when a hydrate's publishBundle() call failed — the SHA that still
  // needs to be published (and then swapped). Retried at the top of every
  // subsequent tick. Phase 5 publishes BEFORE the in-memory swap, so a parked
  // sha has files on disk but live indexes still on the previous sha.
  pendingPublishSha: string | null;
  // ms epoch when a publishBundle() call first failed and parked a sha in
  // pendingPublishSha; null while nothing is pending. Deliberately keeps the
  // ORIGINAL park time across retries — including when a newer, superseding
  // sha replaces the pending one — because the user-facing outage (clients
  // 404ing / reload-looping on a sha that was never published) is continuous
  // from the first failure, not reset by each retry attempt. Drives the
  // freshness "stuck" alarm via pendingPublishAgeSeconds.
  pendingPublishSinceMs: number | null;
  // ms epoch at the top of the most recent tick's try block — a liveness
  // signal for freshness.ts independent of whether that tick found drift.
  lastTickMs: number | null;
  // Sha this process last successfully loaded from atlas_artifacts. Null at
  // boot, so decide() hydrates even when live already equals db (image-baked
  // atlas). Without this, deploying web before the worker's first publish
  // idles forever and /api/freshness looks healthy on stale files.
  storeHydratedSha: string | null;
}
const updaterState: UpdaterState = {
  building: false,
  consecutiveFailures: 0,
  lastError: null,
  divergedSinceMs: null,
  lastSuccessMs: null,
  nextAttemptAt: 0,
  failingTarget: null,
  pendingPublishSha: null,
  pendingPublishSinceMs: null,
  lastTickMs: null,
  storeHydratedSha: null,
};
export function getUpdaterState(): Readonly<UpdaterState> {
  return updaterState;
}

// Whether the updater loop was actually started (false when the kill switch
// ATLAS_UPDATE_ENABLED=0 disabled it). Read by freshness.ts for observability.
let updaterEnabled = false;
export function isUpdaterEnabled(): boolean {
  return updaterEnabled;
}

// Exported so a test can drive it directly with a trivial/fast command (e.g.
// `bun -e`) instead of only ever reaching it indirectly through a real
// sync-embeddings subprocess spawn.
export function spawnCollect(
  cmd: string,
  args: string[],
  capture: boolean,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: config.root,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    });
    let stdout = "";
    if (capture && child.stdout) child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    child.on("error", () => resolve({ code: 1, stdout }));
  });
}

// The narrow slice of spawnCollect that startBootEmbeddings needs (always
// capture=false — just checks the exit code). Injectable so tests can
// exercise the surrounding control flow without dialing a real DB/OpenRouter.
export type SpawnFn = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>;
const realSpawn: SpawnFn = (cmd, args) => spawnCollect(cmd, args, false);

// Poll sync_state.atlas_sha (fast, same-process DB connection; replaces git ls-remote).
export async function getDbAtlasSha(): Promise<string | null> {
  try {
    const rows = await sql`SELECT atlas_sha FROM sync_state WHERE id = 1`;
    return (rows[0] as { atlas_sha?: string } | undefined)?.atlas_sha ?? null;
  } catch (e) {
    console.warn(`getDbAtlasSha: ${(e as Error).message}`);
    return null;
  }
}

/** Injected so runRefreshFromStore is testable without a database. */
export type ArtifactLoader = (
  sha: string,
  names?: readonly string[],
) => Promise<Array<{ name: string; gz: Buffer; sha256?: string; rawBytes?: number }>>;

const defaultLoad: ArtifactLoader = (sha, names) => getArtifacts(sha, names);

// Pull the published artifact set for the live sha into public/, then rebuild
// docs.json from the same transactional snapshot of atlas_doc_meta. Returns
// the sha actually loaded, or null on refusal/failure. No build subprocesses:
// graph/glossary/oea/search-index come from the worker via atlas_artifacts.
export async function runRefreshFromStore(
  log: (m: string) => void,
  load: ArtifactLoader = defaultLoad,
): Promise<string | null> {
  try {
    // Single consistent snapshot: the sha we fetch artifacts for is the sha
    // we stamp onto docs.json. The worker cannot commit a newer pointer
    // mid-read; artifacts for this sha stay in the store (retention > 1).
    let dbSha: string | null = null;
    let docRows: DocMetaRow[] = [];
    await sql.begin(async (tx) => {
      const st = await tx`SELECT atlas_sha FROM sync_state WHERE id = 1`;
      dbSha = (st[0] as { atlas_sha?: string } | undefined)?.atlas_sha ?? null;
      docRows = (await tx`
        SELECT id, doc_no, title, type, depth,
               parent_id AS "parentId", content, ord AS "order",
               node_content_hash AS "contentHash", address_refs AS "addressRefs"
        FROM atlas_doc_meta ORDER BY ord
      `) as unknown as DocMetaRow[];
    });
    if (!dbSha) {
      log("refuse: sync_state has no atlas_sha");
      return null;
    }

    const items = await load(dbSha, PUBLISHED_ARTIFACTS);
    if (items.length === 0) {
      log(`refuse: artifact store has nothing for ${short(dbSha)} — waiting for worker publish`);
      return null;
    }
    const got = new Set(items.map((a) => a.name));
    const missing = PUBLISHED_ARTIFACTS.filter((n) => !got.has(n));
    if (missing.length) {
      log(`refuse: artifact store missing ${missing.join(", ")} for ${short(dbSha)}`);
      return null;
    }

    await writeStoredArtifacts(config.publicDir, items);

    const docMap: Record<string, AtlasNode> = {};
    for (const r of docRows) docMap[r.id] = docRowToNode(r);
    writeDocsJson(config.publicDir, dbSha, docMap);
    log(`refresh-from-store: ${items.length} artifacts + ${docRows.length} docs → public/`);
    return dbSha;
  } catch (e) {
    log(`refresh-from-store error: ${(e as Error).message}`);
    return null;
  }
}

// Seed embeddings only on first boot (table empty). After that, the atlas
// worker cron keeps them current. Detached + best-effort so a slow OpenRouter
// never blocks the health check. Skipped without an API key. `spawn` injectable
// (default real) for the same reason — the real path launches a genuine
// `bun src/server/sync-embeddings.ts` that dials a real DB/OpenRouter, which
// a test must never trigger.
export function startBootEmbeddings(spawn: SpawnFn = realSpawn): void {
  if (!config.openrouterApiKey) {
    console.log("boot-embeddings: skipped (OPENROUTER_API_KEY not set)");
    return;
  }
  void (async () => {
    try {
      const [row] = await sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM atlas_doc_embeddings`;
      if ((row?.n ?? 0) > 0) {
        console.log(`boot-embeddings: ${row.n} present, worker handles updates`);
        return;
      }
    } catch { /* proceed — table may not exist yet */ }
    console.log("boot-embeddings: seeding empty table (detached, best-effort)");
    spawn("bun", ["src/server/sync-embeddings.ts"])
      .then(({ code }) => console.log(`boot-embeddings: exited ${code}`))
      .catch((e) => console.warn(`boot-embeddings: spawn error ${(e as Error).message}`));
  })();
}

// Every effect a tick performs, injected so runTick is testable without
// module mocking (bun's mock.module is process-global in this codebase and
// contaminates sibling test suites — see the coverage-DI note above the
// exports). startUpdater() wires these to the real implementations; tests
// pass fakes that record calls.
export interface TickDeps {
  getUpstream(): Promise<string | null>;
  getLiveSha(): string | null;
  refreshFromStore(): Promise<string | null>;
  // Patches the live indexes in place from the freshly-written disk artifacts.
  // Throws on failure; returns the live atlasCommit sha after a successful patch.
  applyInPlace(): string | null;
  // Full rebuild-from-disk fallback (MiniSearch.loadJSON of the worker's
  // search-index.json). Returns the live atlasCommit sha after the rebuild.
  fullRebuild(): string | null;
  publish(sha: string): Promise<void>;
  broadcast(sha: string): void;
  log(m: string): void;
  now(): number;
  intervalMs: number;
}

function markConverged(state: UpdaterState, deps: TickDeps, sha: string): void {
  state.consecutiveFailures = 0;
  state.failingTarget = null;
  state.nextAttemptAt = 0;
  state.lastError = null;
  state.lastSuccessMs = deps.now();
  state.divergedSinceMs = null;
  state.storeHydratedSha = sha;
  deps.log(`updated → live now ${short(sha)}`);
}

function markFailed(state: UpdaterState, deps: TickDeps, upstream: string | null, lastError: string): void {
  state.failingTarget = upstream;
  state.consecutiveFailures++;
  const wait = backoffMs(state.consecutiveFailures, deps.intervalMs);
  state.nextAttemptAt = deps.now() + wait;
  state.lastError = lastError;
  const level = state.consecutiveFailures >= ESCALATE_AFTER ? "ERROR" : "warn";
  deps.log(`${level}: hydrate for ${short(upstream)} failed (attempt ${state.consecutiveFailures}); retry in ${Math.round(wait / 1000)}s`);
}

async function tryPublish(deps: TickDeps, sha: string, kind: "first" | "retry"): Promise<boolean> {
  try {
    await deps.publish(sha);
    if (kind === "retry") deps.log(`publish-bundle retry succeeded for ${short(sha)}`);
    return true;
  } catch (e) {
    const label = kind === "retry" ? "publish-bundle retry error" : "publish-bundle error";
    deps.log(`${label}: ${(e as Error).message}`);
    return false;
  }
}

function swapLive(deps: TickDeps, sha: string): boolean {
  let newSha: string | null = null;
  try {
    newSha = deps.applyInPlace();
  } catch (e) {
    deps.log(`in-place failed (${(e as Error).message}) — full rebuild fallback`);
    newSha = deps.fullRebuild();
  }
  const converged = newSha === sha;
  if (!converged) deps.log(`WARNING built ${short(sha)} but live is ${short(newSha)}`);
  return converged;
}

function parkPublish(state: UpdaterState, deps: TickDeps, sha: string): void {
  const outcome = publishOutcome(sha, false);
  state.pendingPublishSha = outcome.pendingPublishSha;
  state.pendingPublishSinceMs ??= deps.now();
}

function clearPublish(state: UpdaterState): void {
  state.pendingPublishSha = null;
  state.pendingPublishSinceMs = null;
}

// The full tick body, extracted from startUpdater's closure so it can run
// against fake deps + a throwaway state object in tests. Behavior-identical
// to the original inline tick(): same field mutations, same ordering, same
// log lines. Mutates `state` in place (see UpdaterState header — this is the
// single source of truth read by freshness.ts).
export async function runTick(deps: TickDeps, state: UpdaterState): Promise<void> {
  state.lastTickMs = deps.now();

  // Retry a previously-failed publishBundle before anything else. Phase 5
  // publishes BEFORE the in-memory swap, so a successful retry still has to
  // swap + broadcast — indexes are still on the previous sha.
  if (shouldRetryPublish(state)) {
    const sha = state.pendingPublishSha as string;
    const ok = await tryPublish(deps, sha, "retry");
    if (ok && swapLive(deps, sha)) {
      clearPublish(state);
      markConverged(state, deps, sha);
      deps.broadcast(sha);
    } else if (ok) {
      parkPublish(state, deps, sha);
      markFailed(state, deps, sha, "did not converge after rebuild");
    } else {
      parkPublish(state, deps, sha);
    }
  }

  const upstream = await deps.getUpstream();
  const live = deps.getLiveSha();

  // Divergence clock (drives the stuck alarm) — see nextDivergedSince.
  state.divergedSinceMs = nextDivergedSince(state.divergedSinceMs, upstream, live, deps.now(), state.storeHydratedSha);

  // A fresh upstream target resets backoff — it deserves an immediate try.
  if (upstream && upstream !== state.failingTarget) {
    state.failingTarget = null;
    state.consecutiveFailures = 0;
    state.nextAttemptAt = 0;
  }

  if (decide({
    upstream,
    live,
    building: state.building,
    now: deps.now(),
    nextAttemptAt: state.nextAttemptAt,
    storeHydratedSha: state.storeHydratedSha,
  }) === "build") {
    state.building = true;
    deps.log(`drift: db ${short(upstream)} ≠ live ${short(live)} — loading from artifact store`);

    const builtSha = await deps.refreshFromStore();
    if (!builtSha) {
      markFailed(state, deps, upstream, "refresh-from-store refused/failed");
    } else {
      const published = await tryPublish(deps, builtSha, "first");
      if (!published) {
        parkPublish(state, deps, builtSha);
        markFailed(state, deps, upstream, "publish-bundle failed");
      } else if (swapLive(deps, builtSha)) {
        clearPublish(state);
        markConverged(state, deps, builtSha);
        deps.broadcast(builtSha);
      } else {
        markFailed(state, deps, upstream, "did not converge after rebuild");
      }
    }
    state.building = false;
  }
}

// Start the periodic DB-drift checker. ON by default in every real deploy of
// this server (it IS the single-replica freshness mechanism); ATLAS_UPDATE_ENABLED=0
// is a kill switch to disable it out-of-band (no redeploy) if it ever misbehaves.
// Uses a self-scheduling timer (not setInterval) so ticks never overlap.
// The live sha moved: re-pin it so eviction can never remove the bundle we are
// now serving (bundle-store.ts's pinnedSha). Returns its argument so the two
// swap paths below stay one-liners — a swap that forgot to re-pin would leave
// the PREVIOUS sha protected and the current one evictable, which is the exact
// failure the pin exists to prevent.
function pinLive(sha: string | null): string | null {
  pinBundleSha(sha);
  return sha;
}

export function makeTickDeps(log: (m: string) => void, intervalMs: number): TickDeps {
  return {
    getUpstream: getDbAtlasSha,
    getLiveSha: () => getIndexes().meta.atlasCommit ?? null,
    refreshFromStore: () => runRefreshFromStore(log),
    applyInPlace: () => {
      const d = refreshInPlaceFromDisk(getIndexes());
      log(`in-place: +${d.added.length} ~${d.changed.length} -${d.removed.length} docs`);
      return pinLive(getIndexes().meta.atlasCommit ?? null);
    },
    fullRebuild: () => {
      const ix = rebuildFromDisk();
      return pinLive(ix.meta.atlasCommit ?? null);
    },
    publish: (sha) => publishBundle(MAIN_STORE, sha, config.publicDir),
    broadcast: (sha) => broadcastAtlasUpdate(sha),
    log,
    now: () => Date.now(),
    intervalMs,
  };
}

// Returns a stop handle. The server never calls it (the loop runs for the life
// of the process), but a test that starts the updater must be able to cancel the
// pending timer and clear `updaterEnabled` again — otherwise the flag leaks into
// every later test file, and bun does not order test files predictably.
export function startUpdater(): { stop: () => void } {
  // ATLAS_UPDATE_ENABLED and ATLAS_UPDATE_INTERVAL_MS are read here (call time),
  // not via config.ts — atlas-updater.test.ts mutates process.env then calls
  // startUpdater() directly without a cache-busting reimport, which requires
  // these to track live env rather than whatever config.ts froze at its own
  // first import.
  const disabled = process.env.ATLAS_UPDATE_ENABLED === "0" || process.env.ATLAS_UPDATE_ENABLED === "false";
  if (disabled) {
    console.log("atlas-updater: disabled via ATLAS_UPDATE_ENABLED=0 (kill switch)");
    return { stop: () => {} };
  }
  updaterEnabled = true;

  // Default 30s: polling sync_state is a cheap DB query, not a network call to GitHub.
  const intervalMs = Number(process.env.ATLAS_UPDATE_INTERVAL_MS ?? 30_000);
  const log = (m: string) => console.log(`atlas-updater: ${m}`);

  log(`enabled, interval ${Math.round(intervalMs / 1000)}s (store-driven)`);

  const deps: TickDeps = makeTickDeps(log, intervalMs);

  // Schedule the next tick. The arrow + .catch() guarantees the self-scheduling
  // loop can NEVER surface an unhandled rejection or die: tick() is fully
  // try/catch/finally today, but passing it bare to setTimeout would drop a
  // rejected promise on the floor if a future edit ever threw outside that guard.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick().catch((e) => log(`tick rejected: ${(e as Error).message}`)), intervalMs);
    timer.unref?.();
  };

  async function tick(): Promise<void> {
    try {
      await runTick(deps, updaterState);
    } catch (e) {
      updaterState.building = false;
      log(`tick error: ${(e as Error).message}`);
    } finally {
      schedule();
    }
  }

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      updaterEnabled = false;
    },
  };
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "none";
}
