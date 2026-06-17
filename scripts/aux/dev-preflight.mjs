// Pre-flight for `pnpm dev`: make a from-scratch local checkout runnable with one
// command. Ensures (in order) dependencies are installed (only when stale), the
// Docker daemon is up, the Postgres container is up + healthy, the DB is synced
// to the CHECKED-OUT atlas (via the atlas worker in --no-fetch mode), and the
// reader's atlas artifacts exist — then dev.mjs spawns the server + Vite.
//
// Why run the worker? The in-process updater (src/server/atlas-updater.ts) treats
// the DB's sync_state.atlas_sha as the source of truth and keeps the live indexes
// matching it. Locally nothing advances the DB, so it rots at whatever it was
// first seeded with and the updater loops trying to drag live BACK to that stale
// sha. Running the worker once at startup builds the checked-out submodule commit
// and syncs Postgres so DB == live and the updater goes quiet. Local dev builds
// the pinned commit you have — NOT origin/main, which is the cron worker's job.
//
// Escape hatches:
//   DEV_NO_DB=1     skip all Docker/Postgres/worker steps (reader still works off
//                   the disk artifacts; history/chat/preview just won't have a DB).
//   DEV_NO_WORKER=1 bring the DB up but DON'T run the atlas worker (no fetch/build/
//                   sync). Fast iteration when the DB is already populated; the
//                   server still migrates at boot.
//   DEV_NO_BUILD=1  never build atlas artifacts, even if they're missing.
//   DEV_NO_INSTALL=1 never run pnpm install, even if deps look stale.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const tag = `${GREEN}[setup ]${RESET} `;
const log = (m) => process.stdout.write(`${tag}${m}\n`);
const warn = (m) => process.stdout.write(`${tag}${YELLOW}${m}${RESET}\n`);
const fail = (m) => {
  process.stderr.write(`${tag}${RED}${m}${RESET}\n`);
  process.exit(1);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" });

const truthy = (v) => v === "1" || v === "true";

// ── Dependencies ─────────────────────────────────────────────────────────
// Install only when actually stale — keyed on the pnpm-lock.yaml *content* hash
// (NOT mtime: git checkout/merge rewrites mtimes without changing content, which
// would trigger spurious installs on every branch switch). We stamp the installed
// lock's hash into node_modules; if it still matches, skip — one hash of the lock
// file, no subprocess. Works on a fresh checkout because this script imports only
// node: builtins, so it runs before node_modules exists, then installs.
function ensureDeps() {
  if (truthy(process.env.DEV_NO_INSTALL) || !existsSync("pnpm-lock.yaml")) return;
  const stamp = "node_modules/.dev-deps-hash";
  const want = createHash("sha256").update(readFileSync("pnpm-lock.yaml")).digest("hex");
  const have =
    existsSync("node_modules") && existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : null;
  if (have === want) return;
  log("Dependencies out of date — running pnpm install…");
  if (run("pnpm", ["install"]).status !== 0) fail("`pnpm install` failed — see output above.");
  writeFileSync(stamp, want);
}

// ── Docker daemon ──────────────────────────────────────────────────────────
async function ensureDockerRunning() {
  if (ok("docker", ["info"])) return;
  if (!ok("docker", ["--version"])) {
    fail("Docker is not installed. Install Docker Desktop (https://docker.com) and re-run `pnpm dev`.");
  }
  if (process.platform === "darwin") {
    log("Docker daemon not running — launching Docker Desktop…");
    spawnSync("open", ["-a", "Docker"], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      if (ok("docker", ["info"])) {
        log("Docker daemon is up.");
        return;
      }
      process.stdout.write(".");
    }
    process.stdout.write("\n");
    fail("Docker Desktop didn't come up in ~2min. Start it manually, then re-run `pnpm dev`.");
  }
  // Linux / other: don't guess at init systems — tell the user what to run.
  fail(
    "Docker daemon not running. Start it (e.g. `sudo systemctl start docker`) and re-run `pnpm dev`.\n" +
      "        Or run DB-less: `DEV_NO_DB=1 pnpm dev`.",
  );
}

// ── Compose flavor (`docker compose` ≫ legacy `docker-compose`) ─────────────
function composeCmd() {
  if (ok("docker", ["compose", "version"])) return ["docker", ["compose"]];
  if (ok("docker-compose", ["version"])) return ["docker-compose", []];
  fail("Neither `docker compose` nor `docker-compose` is available.");
}

function dbUp() {
  const [cmd, base] = composeCmd();
  log("Starting Postgres (docker compose up -d)…");
  if (run(cmd, [...base, "up", "-d"]).status !== 0) {
    fail("`compose up -d` failed — see the output above.");
  }
}

// Block until the redlens-pg container reports healthy (it has a healthcheck).
async function waitHealthy(name = "redlens-pg", timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = spawnSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", name], { encoding: "utf8" });
    if ((r.stdout || "").trim() === "healthy") {
      log("Postgres is healthy.");
      return;
    }
    await sleep(1500);
  }
  fail(`Postgres (${name}) didn't become healthy within ${Math.round(timeoutMs / 1000)}s. Check \`docker logs ${name}\`.`);
}

// ── Atlas worker (--no-fetch): build CHECKED-OUT atlas → sync Postgres ───────
// Returns true if it ran to completion (DB now current + artifacts fresh).
function runWorker() {
  if (truthy(process.env.DEV_NO_WORKER) || truthy(process.env.DEV_NO_BUILD)) {
    warn("Skipping atlas worker (DEV_NO_WORKER/DEV_NO_BUILD) — DB may be stale; server migrates at boot.");
    return false;
  }
  log("Syncing Postgres to the checked-out atlas (atlas worker --no-fetch)…");
  log("  ↳ builds index+graph for the pinned submodule commit and syncs Postgres.");
  log("  ↳ first run also walks atlas history — expect a minute or two; later runs fast-exit.");
  // --no-fetch: build the checked-out commit, NOT origin/main (that's the cron's job).
  // bun auto-loads .env.local (DATABASE_URL) for the child, same as `pnpm atlas:worker`.
  if (run("bun", ["scripts/required/atlas-worker.mjs", "--no-fetch"]).status !== 0) {
    warn("Atlas worker didn't finish cleanly — reader still works off disk artifacts; DB may be stale. See output above.");
    return false;
  }
  // The worker builds index+graph but not glossary; refresh it for the synced sha.
  run("pnpm", ["build:glossary"]);
  return true;
}

// ── Atlas artifacts the reader loads (docs.json et al.) ─────────────────────
// Fallback for when the worker was skipped or failed: build them if absent.
function ensureArtifacts() {
  if (truthy(process.env.DEV_NO_BUILD) || existsSync("public/docs.json")) return;
  if (!existsSync("vendor/next-gen-atlas/content")) {
    fail("Atlas submodule isn't populated. Run `pnpm pull-atlas` first, then `pnpm dev`.");
  }
  log("Atlas artifacts missing — building (index → graph → glossary)…");
  for (const t of ["build:index", "build:graph", "build:glossary"]) {
    if (run("pnpm", [t]).status !== 0) fail(`\`pnpm ${t}\` failed — see output above.`);
  }
}

export async function preflight() {
  ensureDeps();
  if (truthy(process.env.DEV_NO_DB)) {
    warn("DEV_NO_DB=1 — skipping Postgres; history/chat/preview need a DB.");
    ensureArtifacts();
    return;
  }
  await ensureDockerRunning();
  dbUp();
  await waitHealthy();
  if (!runWorker()) ensureArtifacts(); // fallback so the reader always has artifacts
  log("Ready — starting server + Vite.");
}
