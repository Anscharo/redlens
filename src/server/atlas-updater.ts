// In-process atlas freshness updater — DB-driven (Part E).
// Polls sync_state.atlas_sha from Postgres every ~30s; on drift, reads
// atlas_doc_meta content from the DB (in ONE transactional snapshot, so the sha
// label always matches the rows) to rebuild public/docs.json and
// public/addresses.atlas.json, then runs build-graph + build-glossary
// subprocesses (which read docs.json), mirrors to dist/, and patches the
// live in-memory indexes via refreshInPlaceFromDisk. No git, no Postgres writes
// — all Postgres writes belong to the worker.
//
// Failure handling: a build that fails or doesn't converge is retried with
// exponential backoff (never permanently skipped — that risked days of silent
// staleness on the few-times-a-week cadence), and escalates to ERROR logs +
// the freshness "stuck" status after ESCALATE_AFTER consecutive failures.
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, readdirSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { sql } from "./db.ts";
import { getIndexes, rebuildFromDisk, docRowToNode, writeDocsJson, writeDocsSplit } from "./indexes.ts";
import { refreshInPlaceFromDisk } from "./atlas-refresh.ts";
import { broadcastAtlasUpdate } from "./sse.ts";
import { MAIN_STORE, publishBundle } from "./bundle-store.ts";
import type { AtlasNode, DocMetaRow } from "./indexes.ts";

export type Decision = "idle" | "build";

// Pure trigger decision (unit-tested). Builds when there is drift and we are
// not already building and the backoff window has elapsed. `now`/`nextAttemptAt`
// (ms epoch) gate retries: a failed/non-converged build sets nextAttemptAt into
// the future, so we re-poll cheaply but don't re-build until it passes.
export function decide(s: {
  upstream: string | null;
  live: string | null;
  building: boolean;
  now: number;
  nextAttemptAt: number;
}): Decision {
  if (s.building) return "idle";
  if (!s.upstream) return "idle";
  if (s.upstream === s.live) return "idle";
  if (s.now < s.nextAttemptAt) return "idle";
  return "build";
}

// Exponential backoff from the poll interval, capped. failures>=1.
export function backoffMs(failures: number, base: number): number {
  const cap = Number(process.env.ATLAS_UPDATE_MAX_BACKOFF_MS ?? 30 * 60_000);
  return Math.min(base * 2 ** Math.min(failures - 1, 20), cap);
}

// Pure: next value of the divergence clock (unit-tested). Set on first
// divergence from a KNOWN upstream; cleared ONLY on real convergence
// (live === upstream); a null/unknown upstream preserves the prior value so a
// transient DB read failure can't keep restarting the stuck timer.
export function nextDivergedSince(
  prev: number | null,
  upstream: string | null,
  live: string | null,
  now: number,
): number | null {
  if (!upstream) return prev;
  if (live === upstream) return null;
  return prev ?? now;
}

// Loud-log + freshness "stuck" threshold (consecutive failed/non-converged builds).
const ESCALATE_AFTER = Number(process.env.ATLAS_UPDATE_ESCALATE_AFTER ?? 3);

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
}
const updaterState: UpdaterState = {
  building: false,
  consecutiveFailures: 0,
  lastError: null,
  divergedSinceMs: null,
  lastSuccessMs: null,
  nextAttemptAt: 0,
  failingTarget: null,
};
export function getUpdaterState(): Readonly<UpdaterState> {
  return updaterState;
}

function spawnCollect(
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

interface AddrRow { address: string; chain: string; entity_label: string | null; roles: string[] | null; aliases: string[] | null; expected_tokens: string[] | null; }

// Rebuild public/docs.json + public/addresses.atlas.json from Postgres, then
// run build-graph and build-glossary subprocesses (they read docs.json), then
// mirror all public/*.json → dist/. Returns the atlas sha actually built (read
// inside the snapshot) on success, or null on failure/refusal.
async function runRefreshFromDb(log: (m: string) => void): Promise<string | null> {
  try {
    // ── ⑥ single consistent snapshot: read the sha AND the rows in ONE
    //    transaction, so the sha we stamp into docs.json always matches the
    //    content we read (the worker can't commit a newer sha mid-read). ──
    let dbSha: string | null = null;
    let docRows: DocMetaRow[] = [];
    let addrRows: AddrRow[] = [];
    await sql.begin(async (tx) => {
      const st = await tx`SELECT atlas_sha FROM sync_state WHERE id = 1`;
      dbSha = (st[0] as { atlas_sha?: string } | undefined)?.atlas_sha ?? null;
      docRows = (await tx`
        SELECT id, doc_no, title, type, depth,
               parent_id AS "parentId", content, ord AS "order"
        FROM atlas_doc_meta ORDER BY ord
      `) as unknown as DocMetaRow[];
      addrRows = (await tx`
        SELECT address, chain, label AS entity_label, roles, aliases, expected_tokens
        FROM atlas_addresses
      `) as unknown as AddrRow[];
    });
    if (!dbSha) {
      log("refuse: sync_state has no atlas_sha");
      return null;
    }
    // No doc-count floor gate: the worker writes docs + sync_state in ONE
    // transaction and we read them back in ONE snapshot, so a present sha always
    // implies a complete doc set. A doc-count delta carries no torn-read signal
    // here — gating on it would only wrongly refuse legitimate large atlas
    // deletions (and pin the reader to a stale version forever).

    // 1. atlas_doc_meta → public/docs.json (stamped with the in-snapshot sha)
    const docMap: Record<string, AtlasNode> = {};
    for (const r of docRows) docMap[r.id] = docRowToNode(r);
    writeDocsJson(config.publicDir, dbSha, docMap);
    // Keep the browser-facing split in lockstep with docs.json so the per-sha
    // bundle never serves a stale tree/content for the new sha.
    writeDocsSplit(config.publicDir, dbSha, docMap);
    log(`refresh-from-db: ${docRows.length} docs → public/docs.json (+meta/content split)`);

    // 2. atlas_addresses → public/addresses.atlas.json (seed for build-graph)
    const addrAtlas: Record<string, object> = {};
    for (const r of addrRows) {
      addrAtlas[r.address] = {
        chain: r.chain,
        entityLabel: r.entity_label,
        roles: r.roles ?? [],
        aliases: r.aliases ?? [],
        expectedTokens: r.expected_tokens ?? [],
      };
    }
    writeFileSync(join(config.publicDir, "addresses.atlas.json"), JSON.stringify({ atlasCommit: dbSha, addresses: addrAtlas }));

    // 3. build-graph subprocess (reads docs.json → graph.json, relations.json; enriches addresses.atlas.json)
    const { code: gc } = await spawnCollect("bun", ["scripts/required/build-graph.mjs"], false);
    if (gc !== 0) throw new Error(`build-graph exited ${gc}`);

    // 4. build-glossary + report views (read docs.json/relations.json)
    const { code: glc } = await spawnCollect("bun", ["scripts/required/build-glossary.mjs"], false);
    if (glc !== 0) throw new Error(`build-glossary exited ${glc}`);
    const { code: oea } = await spawnCollect("bun", ["scripts/required/build-oea-report.ts"], false);
    if (oea !== 0) throw new Error(`build-oea-report exited ${oea}`);

    // 5. Mirror public/*.json → dist/ (skip search-index.json — refreshInPlaceFromDisk writes it).
    const distDir = config.distDir;
    if (existsSync(distDir)) {
      let n = 0;
      for (const f of readdirSync(config.publicDir)) {
        if (f.endsWith(".json") && f !== "search-index.json") {
          copyFileSync(join(config.publicDir, f), join(distDir, f));
          n++;
        }
      }
      const si = join(distDir, "search-index.json");
      if (existsSync(si)) unlinkSync(si);
      log(`refresh-from-db: mirrored ${n} json → dist/`);
    }

    return dbSha;
  } catch (e) {
    log(`refresh-from-db error: ${(e as Error).message}`);
    return null;
  }
}

// Seed embeddings only on first boot (table empty). After that, the atlas
// worker cron keeps them current. Detached + best-effort so a slow OpenRouter
// never blocks the health check. Skipped without an API key.
export function startBootEmbeddings(): void {
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
    spawnCollect("bun", ["src/server/sync-embeddings.ts"], false)
      .then(({ code }) => console.log(`boot-embeddings: exited ${code}`))
      .catch((e) => console.warn(`boot-embeddings: spawn error ${(e as Error).message}`));
  })();
}

// Start the periodic DB-drift checker. ON by default in every real deploy of
// this server (it IS the single-replica freshness mechanism); ATLAS_UPDATE_ENABLED=0
// is a kill switch to disable it out-of-band (no redeploy) if it ever misbehaves.
// Uses a self-scheduling timer (not setInterval) so ticks never overlap.
export function startUpdater(): void {
  const disabled = process.env.ATLAS_UPDATE_ENABLED === "0" || process.env.ATLAS_UPDATE_ENABLED === "false";
  if (disabled) {
    console.log("atlas-updater: disabled via ATLAS_UPDATE_ENABLED=0 (kill switch)");
    return;
  }
  // Default 30s: polling sync_state is a cheap DB query, not a network call to GitHub.
  const intervalMs = Number(process.env.ATLAS_UPDATE_INTERVAL_MS ?? 30_000);
  const log = (m: string) => console.log(`atlas-updater: ${m}`);

  log(`enabled, interval ${Math.round(intervalMs / 1000)}s (DB-driven)`);

  // Schedule the next tick. The arrow + .catch() guarantees the self-scheduling
  // loop can NEVER surface an unhandled rejection or die: tick() is fully
  // try/catch/finally today, but passing it bare to setTimeout would drop a
  // rejected promise on the floor if a future edit ever threw outside that guard.
  const schedule = () =>
    setTimeout(() => void tick().catch((e) => log(`tick rejected: ${(e as Error).message}`)), intervalMs).unref?.();

  async function tick(): Promise<void> {
    try {
      const upstream = await getDbAtlasSha();
      const live = getIndexes().meta.atlasCommit ?? null;

      // Divergence clock (drives the stuck alarm) — see nextDivergedSince.
      updaterState.divergedSinceMs = nextDivergedSince(updaterState.divergedSinceMs, upstream, live, Date.now());

      // A fresh upstream target resets backoff — it deserves an immediate try.
      if (upstream && upstream !== updaterState.failingTarget) {
        updaterState.failingTarget = null;
        updaterState.consecutiveFailures = 0;
        updaterState.nextAttemptAt = 0;
      }

      if (decide({ upstream, live, building: updaterState.building, now: Date.now(), nextAttemptAt: updaterState.nextAttemptAt }) === "build") {
        updaterState.building = true;
        log(`drift: db ${short(upstream)} ≠ live ${short(live)} — rebuilding from DB`);

        const builtSha = await runRefreshFromDb(log);
        let converged = false;
        if (builtSha) {
          let newSha: string | null;
          try {
            const d = refreshInPlaceFromDisk(getIndexes());
            newSha = getIndexes().meta.atlasCommit ?? null;
            log(`in-place: +${d.added.length} ~${d.changed.length} -${d.removed.length} docs`);
          } catch (e) {
            log(`in-place failed (${(e as Error).message}) — full rebuild fallback`);
            newSha = rebuildFromDisk().meta.atlasCommit ?? null;
          }
          converged = newSha === builtSha;
          if (!converged) log(`WARNING built ${short(builtSha)} but live is ${short(newSha)}`);
        }

        if (converged) {
          updaterState.consecutiveFailures = 0;
          updaterState.failingTarget = null;
          updaterState.nextAttemptAt = 0;
          updaterState.lastError = null;
          updaterState.lastSuccessMs = Date.now();
          updaterState.divergedSinceMs = null;
          log(`updated → live now ${short(builtSha)}`);
          if (builtSha) {
            // Publish the immutable per-SHA bundle (fresh .gz from current
            // public/*.json — including the search-index.json just rewritten by
            // refreshInPlaceFromDisk) BEFORE telling clients to fetch it.
            try {
              await publishBundle(MAIN_STORE, builtSha, config.publicDir);
            } catch (e) {
              log(`publish-bundle error: ${(e as Error).message}`);
            }
            broadcastAtlasUpdate(builtSha);
          }
        } else {
          // ① + ⑤ bounded retry with backoff + escalation — never a permanent skip.
          updaterState.failingTarget = upstream;
          updaterState.consecutiveFailures++;
          const wait = backoffMs(updaterState.consecutiveFailures, intervalMs);
          updaterState.nextAttemptAt = Date.now() + wait;
          updaterState.lastError = builtSha ? "did not converge after rebuild" : "refresh-from-db refused/failed";
          const level = updaterState.consecutiveFailures >= ESCALATE_AFTER ? "ERROR" : "warn";
          log(`${level}: build for ${short(upstream)} failed (attempt ${updaterState.consecutiveFailures}); retry in ${Math.round(wait / 1000)}s`);
        }
        updaterState.building = false;
      }
    } catch (e) {
      updaterState.building = false;
      log(`tick error: ${(e as Error).message}`);
    } finally {
      schedule();
    }
  }

  schedule();
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "none";
}
