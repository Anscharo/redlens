// In-process atlas freshness updater (Alternative A — see
// docs/plans/atlas-runtime-freshness-inprocess.md). A checker compares the
// upstream atlas head (git ls-remote) against the live in-memory sha; on drift it
// spawns a build subprocess (refresh-atlas-build.mjs) to regenerate artifacts on
// disk, then atomically swaps the in-memory indexes via rebuildFromDisk (which
// advances meta.atlasCommit) and kicks the DB sync lanes. Single-replica, single
// build in flight. This is the full-rebuild+swap path; the subprocess-shrink
// (server owns the index, patchDocs + toJSON) layers on later.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { config } from "./config.ts";
import { getIndexes, rebuildFromDisk } from "./indexes.ts";
import { refreshInPlaceFromDisk } from "./atlas-refresh.ts";

const SUBMODULE = join(config.root, "vendor/next-gen-atlas");

export type Decision = "idle" | "build";

// Pure trigger decision (unit-tested). `lastTried` is the target sha of a build
// that COMPLETED but failed to advance the live sha (a broken build); we don't
// re-trigger it until upstream moves again, so a broken build degrades to
// stuck-stale + loud logs instead of an infinite rebuild loop. A *failed* build
// (nonzero exit) does NOT set lastTried, so transient failures still retry.
export function decide(s: {
  upstream: string | null;
  live: string | null;
  building: boolean;
  lastTried: string | null;
}): Decision {
  if (s.building) return "idle";
  if (!s.upstream) return "idle"; // couldn't read upstream this tick
  if (s.upstream === s.live) return "idle"; // fresh
  if (s.upstream === s.lastTried) return "idle"; // already attempted, didn't take
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

// Upstream atlas head via the submodule's origin remote (no checkout).
export async function getUpstreamSha(): Promise<string | null> {
  const { code, stdout } = await spawnCollect(
    "git",
    ["-C", SUBMODULE, "ls-remote", "origin", "refs/heads/main"],
    true,
  );
  if (code !== 0) return null;
  const sha = stdout.trim().split(/\s+/)[0] ?? "";
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

async function runRefreshBuild(): Promise<boolean> {
  // BUILD_SKIP_SEARCH_INDEX=1: the subprocess emits docs.json/graph.json/etc.
  // WITHOUT the heavy MiniSearch index — the server patches + re-serializes it
  // (refreshInPlaceFromDisk), so the ~316 MB index build never runs in the
  // subprocess. Drops subprocess peak ~316 MB → ~180 MB.
  const { code } = await spawnCollect("bun", ["scripts/required/refresh-atlas-build.mjs"], false, {
    BUILD_SKIP_SEARCH_INDEX: "1",
  });
  return code === 0;
}

// Best-effort DB lanes after a successful swap, run sequentially (sync:atlas
// structural, then sync:embeddings) so two heavy bun subprocesses don't hit the
// live server at once. Fire-and-forget at the call site so it never blocks the
// loop.
async function kickSync(log: (m: string) => void): Promise<void> {
  for (const script of ["src/server/sync.ts", "src/server/sync-embeddings.ts"]) {
    try {
      const { code } = await spawnCollect("bun", [script], false);
      log(`${script} exited ${code}`);
    } catch {
      log(`${script} spawn error`);
    }
  }
}

// Populate/refresh embeddings once at boot — covers first deploy and every
// redeploy (e.g. a GitHub-triggered rebuild). Detached + best-effort so a slow
// or failing OpenRouter never blocks the health check; hash-gated, so it's a
// fast no-op when embeddings are already current. (The updater's kickSync covers
// runtime atlas-poll updates; this covers deploys.) Skipped without an API key.
export function startBootEmbeddings(): void {
  if (!config.openrouterApiKey) {
    console.log("boot-embeddings: skipped (OPENROUTER_API_KEY not set)");
    return;
  }
  console.log("boot-embeddings: sync:embeddings (detached, best-effort)");
  spawnCollect("bun", ["src/server/sync-embeddings.ts"], false)
    .then(({ code }) => console.log(`boot-embeddings: exited ${code}`))
    .catch((e) => console.warn(`boot-embeddings: spawn error ${(e as Error).message}`));
}

// Start the periodic checker. No-op unless ATLAS_UPDATE_ENABLED is set. Uses a
// self-scheduling timer (not setInterval) so ticks never overlap.
export function startUpdater(): void {
  const enabled = process.env.ATLAS_UPDATE_ENABLED === "1" || process.env.ATLAS_UPDATE_ENABLED === "true";
  if (!enabled) {
    console.log("atlas-updater: disabled (set ATLAS_UPDATE_ENABLED=1 to enable)");
    return;
  }
  const intervalMs = Number(process.env.ATLAS_UPDATE_INTERVAL_MS ?? 5 * 60_000);
  const log = (m: string) => console.log(`atlas-updater: ${m}`);

  let building = false;
  let lastTried: string | null = null;

  log(`enabled, interval ${Math.round(intervalMs / 1000)}s`);

  async function tick(): Promise<void> {
    try {
      const upstream = await getUpstreamSha();
      const live = getIndexes().meta.atlasCommit ?? null;
      if (decide({ upstream, live, building, lastTried }) === "build") {
        building = true;
        log(`drift: upstream ${short(upstream)} ≠ live ${short(live)} — building`);
        const ok = await runRefreshBuild();
        if (ok) {
          // Primary: in-place patch + re-serialize the index. Fallback (full
          // rebuild + swap) recovers from any in-place failure — readArtifacts
          // sees no search-index.json (subprocess dropped it) → addAll rebuild.
          let newSha: string | null;
          try {
            const d = refreshInPlaceFromDisk(getIndexes());
            newSha = getIndexes().meta.atlasCommit ?? null;
            log(`in-place: +${d.added.length} ~${d.changed.length} -${d.removed.length} docs`);
          } catch (e) {
            log(`in-place update failed (${(e as Error).message}) — full rebuild+swap fallback`);
            newSha = rebuildFromDisk().meta.atlasCommit ?? null;
          }
          if (newSha === upstream) {
            log(`updated → live now ${short(newSha)}`);
            lastTried = null;
            void kickSync(log); // fire-and-forget; DB lanes are best-effort
          } else {
            lastTried = upstream; // updated but sha didn't advance — stop hammering
            log(`WARNING updated but live is ${short(newSha)} (expected ${short(upstream)}); not advancing — will not retry this target`);
          }
        } else {
          log("build failed — will retry next interval"); // transient: do NOT set lastTried
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
