// Process plumbing for scripts/required/atlas-worker.mjs: the repo root it runs
// children from, the two ways it runs them, and the upstream atlas SHA probe.
// Every child runs with cwd = repo root and inherits stdio, so its output lands
// in the worker's own log stream.
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SUBMODULE = path.join(ROOT, "vendor/next-gen-atlas");

/** Runs a command to completion; throws on a non-zero exit. */
export function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
}

/** Spawns a command; resolves on exit 0, rejects on any other exit or a spawn error. */
export function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${cmd} ${args.join(" ")} &`);
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0]} exited ${code}`));
    });
    child.on("error", reject);
  });
}

/**
 * The atlas commit this tick should sync to, or null when it cannot be read.
 * Under --no-fetch the "upstream" is the checked-out submodule commit, so the DB
 * is synced to exactly what is on disk; otherwise it is the tip of origin/main.
 */
export async function readUpstreamSha(noFetch) {
  const ref = noFetch ? ["rev-parse", "HEAD"] : ["ls-remote", "origin", "refs/heads/main"];
  try {
    const { stdout } = await new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", SUBMODULE, ...ref], {
        stdio: ["ignore", "pipe", "inherit"],
        cwd: ROOT,
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, stdout: out }));
      child.on("error", reject);
    });
    const sha = stdout.trim().split(/\s+/)[0] ?? "";
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
