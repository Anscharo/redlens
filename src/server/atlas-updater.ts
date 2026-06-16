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
import { getIndexes, rebuildFromDisk } from "./indexes.ts";
import { refreshInPlaceFromDisk } from "./atlas-refresh.ts";
import { broadcastAtlasUpdate } from "./sse.ts";
import type { AtlasNode } from "./indexes.ts";

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

// Loud-log + freshness "stuck" threshold (consecutive failed/non-converged builds).
const ESCALATE_AFTER = Number(process.env.ATLAS_UPDATE_ESCALATE_AFTER ?? 3);

// Observable updater state, read by freshness.ts to distinguish a benign
// not-yet-converged updater ("syncing") from one that is genuinely stuck.
export interface UpdaterState {
  building: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  // ms epoch when live first diverged from upstream and hasn't reconverged;
  // null while converged. Drives the stuck alarm.
  divergedSinceMs: number | null;
  lastSuccessMs: number | null;
}
const updaterState: UpdaterState = {
  building: false,
  consecutiveFailures: 0,
  lastError: null,
  divergedSinceMs: null,
  lastSuccessMs: null,
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
  } catch {
    return null;
  }
}

interface DocRow { id: string; doc_no: string; title: string; type: string; depth: number; parentId: string | null; content: string | null; order: number; }
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
    let docRows: DocRow[] = [];
    let addrRows: AddrRow[] = [];
    await sql.begin(async (tx) => {
      const st = await tx`SELECT atlas_sha FROM sync_state WHERE id = 1`;
      dbSha = (st[0] as { atlas_sha?: string } | undefined)?.atlas_sha ?? null;
      docRows = (await tx`
        SELECT id, doc_no, title, type, depth,
               parent_id AS "parentId", content, ord AS "order"
        FROM atlas_doc_meta ORDER BY ord
      `) as unknown as DocRow[];
      addrRows = (await tx`
        SELECT address, chain, label AS entity_label, roles, aliases, expected_tokens
        FROM atlas_addresses
      `) as unknown as AddrRow[];
    });
    if (!dbSha) {
      log("refuse: sync_state has no atlas_sha");
      return null;
    }

    // ── A.2 sanity floor gate: never swap to an empty or drastically smaller
    //    doc set (a torn/half-truncated DB read). Refuse → keep last-good. ──
    const liveCount = (() => { try { return getIndexes().docMap.size; } catch { return 0; } })();
    const floorRatio = Number(process.env.ATLAS_MIN_DOC_RATIO ?? 0.5);
    if (docRows.length === 0) {
      log(`refuse: DB returned 0 docs (live has ${liveCount}) — keeping last-good`);
      return null;
    }
    if (liveCount > 0 && docRows.length < liveCount * floorRatio) {
      log(`refuse: DB doc count ${docRows.length} < ${Math.round(floorRatio * 100)}% of live ${liveCount} — keeping last-good`);
      return null;
    }

    // 1. atlas_doc_meta → public/docs.json (stamped with the in-snapshot sha)
    const docMap: Record<string, AtlasNode> = {};
    for (const r of docRows) {
      docMap[r.id] = {
        id: r.id,
        doc_no: r.doc_no,
        title: r.title,
        type: r.type,
        depth: r.depth,
        parentId: r.parentId,
        content: r.content ?? "",
        order: r.order,
      };
    }
    writeFileSync(join(config.publicDir, "docs.json"), JSON.stringify({ atlasCommit: dbSha, nodes: docMap }));
    log(`refresh-from-db: ${docRows.length} docs → public/docs.json`);

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

    // 4. build-glossary subprocess (reads docs.json → glossary.json)
    const { code: glc } = await spawnCollect("bun", ["scripts/required/build-glossary.mjs"], false);
    if (glc !== 0) throw new Error(`build-glossary exited ${glc}`);

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

// Start the periodic DB-drift checker. No-op unless ATLAS_UPDATE_ENABLED is set.
// Uses a self-scheduling timer (not setInterval) so ticks never overlap.
export function startUpdater(): void {
  const enabled = process.env.ATLAS_UPDATE_ENABLED === "1" || process.env.ATLAS_UPDATE_ENABLED === "true";
  if (!enabled) {
    console.log("atlas-updater: disabled (set ATLAS_UPDATE_ENABLED=1 to enable)");
    return;
  }
  // Default 30s: polling sync_state is a cheap DB query, not a network call to GitHub.
  const intervalMs = Number(process.env.ATLAS_UPDATE_INTERVAL_MS ?? 30_000);
  const log = (m: string) => console.log(`atlas-updater: ${m}`);

  let building = false;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  let failingTarget: string | null = null;

  log(`enabled, interval ${Math.round(intervalMs / 1000)}s (DB-driven)`);

  async function tick(): Promise<void> {
    try {
      const upstream = await getDbAtlasSha();
      const live = getIndexes().meta.atlasCommit ?? null;

      // Divergence clock (drives the stuck alarm): set when live first differs
      // from a known upstream, cleared on convergence / no-drift.
      if (upstream && live !== upstream) {
        if (updaterState.divergedSinceMs === null) updaterState.divergedSinceMs = Date.now();
      } else {
        updaterState.divergedSinceMs = null;
      }

      // A fresh upstream target resets backoff — it deserves an immediate try.
      if (upstream && upstream !== failingTarget) {
        failingTarget = null;
        consecutiveFailures = 0;
        nextAttemptAt = 0;
      }

      if (decide({ upstream, live, building, now: Date.now(), nextAttemptAt }) === "build") {
        building = true;
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
          consecutiveFailures = 0;
          failingTarget = null;
          nextAttemptAt = 0;
          updaterState.consecutiveFailures = 0;
          updaterState.lastError = null;
          updaterState.lastSuccessMs = Date.now();
          updaterState.divergedSinceMs = null;
          log(`updated → live now ${short(builtSha)}`);
          if (builtSha) broadcastAtlasUpdate(builtSha);
        } else {
          // ① + ⑤ bounded retry with backoff + escalation — never a permanent skip.
          failingTarget = upstream;
          consecutiveFailures++;
          const wait = backoffMs(consecutiveFailures, intervalMs);
          nextAttemptAt = Date.now() + wait;
          updaterState.consecutiveFailures = consecutiveFailures;
          updaterState.lastError = builtSha ? "did not converge after rebuild" : "refresh-from-db refused/failed";
          const level = consecutiveFailures >= ESCALATE_AFTER ? "ERROR" : "warn";
          log(`${level}: build for ${short(upstream)} failed (attempt ${consecutiveFailures}); retry in ${Math.round(wait / 1000)}s`);
        }
        building = false;
        updaterState.building = false;
      }
    } catch (e) {
      building = false;
      updaterState.building = false;
      log(`tick error: ${(e as Error).message}`);
    } finally {
      setTimeout(tick, intervalMs).unref?.();
    }
  }

  setTimeout(tick, intervalMs).unref?.();
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "none";
}
