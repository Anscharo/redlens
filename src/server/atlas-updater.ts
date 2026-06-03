// In-process atlas freshness updater — DB-driven (Part E).
// Polls sync_state.atlas_sha from Postgres every ~30s; on drift, reads
// atlas_doc_meta content from the DB to rebuild public/docs.json and
// public/addresses.atlas.json, then runs build-graph + build-glossary
// subprocesses (which read docs.json), mirrors to dist/, and patches the
// live in-memory indexes via refreshInPlaceFromDisk. No git ls-remote, no
// git fetch, no Postgres writes — all Postgres writes belong to the worker.
import { spawn } from "node:child_process";
import { writeFileSync, existsSync, readdirSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { sql } from "./db.ts";
import { getIndexes, rebuildFromDisk } from "./indexes.ts";
import { refreshInPlaceFromDisk } from "./atlas-refresh.ts";
import type { AtlasNode } from "./indexes.ts";

export type Decision = "idle" | "build";

// Pure trigger decision (unit-tested). `lastTried` is the target sha of a
// build that COMPLETED but failed to advance the live sha; we don't re-trigger
// until upstream moves again. A *failed* build does NOT set lastTried.
export function decide(s: {
  upstream: string | null;
  live: string | null;
  building: boolean;
  lastTried: string | null;
}): Decision {
  if (s.building) return "idle";
  if (!s.upstream) return "idle";
  if (s.upstream === s.live) return "idle";
  if (s.upstream === s.lastTried) return "idle";
  return "build";
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

// Rebuild public/docs.json + public/addresses.atlas.json from Postgres, then
// run build-graph and build-glossary subprocesses (they read docs.json), then
// mirror all public/*.json → dist/. This replaces the old refresh-atlas-build.mjs
// subprocess which needed git. Returns true on success.
async function runRefreshFromDb(dbSha: string, log: (m: string) => void): Promise<boolean> {
  try {
    // 1. Read atlas_doc_meta → write public/docs.json
    interface DocRow { id: string; doc_no: string; title: string; type: string; depth: number; parentId: string | null; content: string | null; order: number; }
    const docRows = await sql<DocRow[]>`
      SELECT id, doc_no, title, type, depth,
             parent_id AS "parentId", content, ord AS "order"
      FROM atlas_doc_meta ORDER BY ord
    `;
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
    writeFileSync(join(config.publicDir, "docs.json"), JSON.stringify(docMap));
    log(`refresh-from-db: ${docRows.length} docs → public/docs.json`);

    // 2. Read atlas_addresses → write public/addresses.atlas.json (seed for build-graph)
    interface AddrRow { address: string; chain: string; entity_label: string | null; roles: string[] | null; aliases: string[] | null; expected_tokens: string[] | null; }
    const addrRows = await sql<AddrRow[]>`
      SELECT address, chain, label AS entity_label, roles, aliases, expected_tokens
      FROM atlas_addresses
    `;
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
    writeFileSync(join(config.publicDir, "addresses.atlas.json"), JSON.stringify(addrAtlas));

    // 3. Run build-graph subprocess (reads docs.json → writes graph.json, relations.json; enriches addresses.atlas.json)
    const { code: gc } = await spawnCollect("bun", ["scripts/required/build-graph.mjs"], false);
    if (gc !== 0) throw new Error(`build-graph exited ${gc}`);

    // 4. Run build-glossary subprocess (reads docs.json → writes glossary.json)
    const { code: glc } = await spawnCollect("bun", ["scripts/required/build-glossary.mjs"], false);
    if (glc !== 0) throw new Error(`build-glossary exited ${glc}`);

    // 5. Write minimal manifest so refreshInPlaceFromDisk reads the correct atlasCommit
    writeFileSync(join(config.publicDir, "manifest.json"), JSON.stringify({ atlasCommit: dbSha }));

    // 6. Mirror public/*.json → dist/ (skip search-index.json — refreshInPlaceFromDisk writes it)
    const distDir = config.distDir;
    if (existsSync(distDir)) {
      let n = 0;
      for (const f of readdirSync(config.publicDir)) {
        if (f.endsWith(".json") && f !== "search-index.json") {
          copyFileSync(join(config.publicDir, f), join(distDir, f));
          n++;
        }
      }
      // Drop stale search-index so refreshInPlaceFromDisk writes a fresh one
      const si = join(distDir, "search-index.json");
      if (existsSync(si)) unlinkSync(si);
      log(`refresh-from-db: mirrored ${n} json → dist/`);
    }

    return true;
  } catch (e) {
    log(`refresh-from-db error: ${(e as Error).message}`);
    return false;
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
  let lastTried: string | null = null;

  log(`enabled, interval ${Math.round(intervalMs / 1000)}s (DB-driven)`);

  async function tick(): Promise<void> {
    try {
      const upstream = await getDbAtlasSha();
      const live = getIndexes().meta.atlasCommit ?? null;
      if (decide({ upstream, live, building, lastTried }) === "build") {
        building = true;
        log(`drift: db ${short(upstream)} ≠ live ${short(live)} — rebuilding from DB`);
        const ok = await runRefreshFromDb(upstream!, log);
        if (ok) {
          let newSha: string | null;
          try {
            const d = refreshInPlaceFromDisk(getIndexes());
            // Advance atlasCommit to the DB sha (manifest was written with this sha).
            getIndexes().meta = { ...getIndexes().meta, atlasCommit: upstream };
            newSha = upstream;
            log(`in-place: +${d.added.length} ~${d.changed.length} -${d.removed.length} docs`);
          } catch (e) {
            log(`in-place failed (${(e as Error).message}) — full rebuild fallback`);
            newSha = rebuildFromDisk().meta.atlasCommit ?? null;
          }
          if (newSha === upstream) {
            log(`updated → live now ${short(newSha)}`);
            lastTried = null;
          } else {
            lastTried = upstream;
            log(`WARNING updated but live is ${short(newSha)} (expected ${short(upstream)}); not retrying this target`);
          }
        } else {
          log("refresh-from-db failed — will retry next interval");
        }
        building = false;
      }
    } catch (e) {
      building = false;
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
