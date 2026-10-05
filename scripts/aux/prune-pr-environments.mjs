#!/usr/bin/env node
/**
 * `pnpm env:prune` — delete the GitHub *deployment environment* records that
 * Railway's per-PR environments leave behind on this repo.
 *
 * Why these pile up: Railway creates a GitHub Deployment per PR env, and GitHub
 * auto-creates a repository Environment for any environment name a deployment
 * names. Railway de-provisions its own environment when the PR closes, but
 * nothing on the GitHub side ever removes the record — so /settings/environments
 * grows one dead row per PR, forever (113 environments by 2026-09, 101 of them
 * dead PR rows).
 *
 * Deleting one does NOT touch Railway (already gone) and does NOT touch the PR.
 * It DOES delete that environment's deployment records, so the "Deployments"
 * links on those closed PRs stop resolving. That is the whole cost.
 *
 * SAFETY: dry-run by default — pass --apply to actually delete. Every keep/delete
 * rule lives in scripts/lib/prune-plan.ts and is unit-tested in
 * scripts_tests/prune-plan.test.ts; this file is only the I/O around them. In
 * short: a name must parse as a PR environment to be a candidate at all, a
 * candidate whose PR is still OPEN is kept, a candidate whose number resolves to
 * no PR is reported but kept unless --orphans, and PROTECTED_ENVIRONMENTS can
 * never be touched whatever the parse says.
 *
 * TOKEN: needs repo-admin rights AND pull-request read. A classic PAT with
 * `repo` covers both; a fine-grained PAT needs Administration: write (
 * Environments: write alone 403s — github.com/orgs/community/discussions/58868)
 * plus Pull requests: read. The Actions GITHUB_TOKEN CANNOT do this at any
 * permissions: setting, because neither `administration` nor `environments` is a
 * grantable key — which is why env-prune.yml reads its own token from a secret.
 * Read from GITHUB_TOKEN / GH_TOKEN, else `gh auth token`.
 *
 * Flags:
 *   --apply         actually delete (default: dry run)
 *   --orphans       also delete candidates whose PR number resolves to nothing
 *   --repo O/R      target repo (default: parsed from the origin remote)
 *   --keep <name>   never touch this environment (repeatable, exact match)
 *   --pr <n>        only consider the environments belonging to PR n
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  looksLikeMissingPrScope,
  parsePruneArgs,
  planPrune,
  selectCandidates,
} from "../lib/prune-plan.ts";

// GITHUB_API_URL is set by Actions itself (and points at the host on GHES), so
// honouring it costs nothing and keeps the script pointable at a mock.
const API = process.env.GITHUB_API_URL || "https://api.github.com";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveRepo(explicit) {
  if (explicit) return explicit;
  const url = sh("git", ["remote", "get-url", "origin"]);
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (!m) throw new Error(`could not parse owner/repo from origin remote: ${url}`);
  return m[1];
}

function resolveToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return sh("gh", ["auth", "token"]);
  } catch {
    throw new Error(
      "no token. Set GITHUB_TOKEN (classic PAT with `repo`, or fine-grained with\n" +
        "Administration: write + Pull requests: read) or sign in with `gh auth login`.",
    );
  }
}

function makeApi(token) {
  /**
   * @param allow404 Treat 404 as data rather than an error. Opt-in per call
   *   BECAUSE a fine-grained token without the right permission answers 404, not
   *   403 — so blanket 404 tolerance would turn "no access to this repo" into a
   *   cheerful "0 environments, nothing to delete". Only the PR lookup, where a
   *   missing PR is a real answer, passes it — and looksLikeMissingPrScope then
   *   catches the case where that answer was really a scope problem.
   */
  return async function api(method, apiPath, { allow404 = false, retried = false } = {}) {
    const res = await fetch(`${API}${apiPath}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "redlens-env-prune",
      },
    });
    if (res.status === 404 && allow404) return { status: 404, body: null };
    if (res.ok) return { status: res.status, body: res.status === 204 ? null : await res.json() };

    const text = await res.text();
    // GitHub answers a SECONDARY rate limit with 403 as well, so the permission
    // message below must not claim every 403 is a permissions problem. Retry
    // once, honouring retry-after, before giving up on this call.
    const limited =
      res.status === 429 ||
      /secondary rate limit|abuse detection/i.test(text) ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
    if (limited && !retried) {
      const waitSec = Number(res.headers.get("retry-after")) || 60;
      console.error(`  rate limited, waiting ${waitSec}s then retrying once…`);
      await sleep(waitSec * 1000);
      return api(method, apiPath, { allow404, retried: true });
    }
    if (res.status === 403 || res.status === 404) {
      throw new Error(
        `${method} ${apiPath} → ${res.status}. Most likely the token lacks repo-admin\n` +
          "rights: a classic PAT needs `repo`, a fine-grained one needs Administration:\n" +
          `write. GitHub answers 404 (not 403) for a permission it will not confirm.\n${text.slice(0, 200)}`,
      );
    }
    throw new Error(`${method} ${apiPath} → ${res.status}: ${text.slice(0, 300)}`);
  };
}

async function listEnvironments(api, repo) {
  const all = [];
  for (let page = 1; ; page++) {
    const { body } = await api("GET", `/repos/${repo}/environments?per_page=100&page=${page}`);
    const batch = body?.environments ?? [];
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

/** PR state per number, looked up 8 at a time — ~100 calls, well inside the limit. */
async function prStates(api, repo, numbers) {
  const states = new Map();
  const queue = [...new Set(numbers)];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let pr = queue.pop(); pr !== undefined; pr = queue.pop()) {
        const { status, body } = await api("GET", `/repos/${repo}/pulls/${pr}`, { allow404: true });
        states.set(pr, status === 404 ? "missing" : body.state);
      }
    }),
  );
  return states;
}

async function main(argv) {
  const { apply, orphans, onlyPr, keeps, repo: repoArg } = parsePruneArgs(argv);
  const repo = resolveRepo(repoArg);
  const api = makeApi(resolveToken());

  const environments = await listEnvironments(api, repo);
  const { candidates, keptCount } = selectCandidates(environments, { onlyPr, keeps });
  const states = await prStates(api, repo, candidates.map((c) => c.pr));

  if (looksLikeMissingPrScope(candidates, states)) {
    throw new Error(
      `all ${candidates.length} PR lookups returned 404, which is a token scope problem,\n` +
        "not a repo where every PR vanished. A fine-grained token needs Pull requests:\n" +
        "read alongside Administration: write. Refusing to prune — with --orphans this\n" +
        "would have deleted environments belonging to OPEN PRs.",
    );
  }

  const { open, stale, unknown, doomed } = planPrune(candidates, states, { orphans });

  const keptLabel = onlyPr === undefined ? "not a prunable PR environment" : `outside PR #${onlyPr}`;
  console.log(`${repo}: ${environments.length} environments`);
  console.log(`  ${keptCount} ${keptLabel} (kept, untouched)`);
  console.log(`  ${open.length} PR environments whose PR is still open (kept)`);
  console.log(
    `  ${unknown.length} whose PR number resolves to nothing` +
      (orphans ? " (--orphans: deleting)" : " (kept — pass --orphans to delete)"),
  );
  for (const c of unknown) console.log(`      ? ${c.name} (no PR #${c.pr})`);
  console.log(`  ${stale.length} whose PR is closed/merged → deletable`);

  if (!doomed.length) {
    console.log("\nnothing to delete.");
    return;
  }
  if (!apply) {
    for (const c of doomed) console.log(`      - ${c.name} (PR #${c.pr})`);
    console.log(`\ndry run — re-run with --apply to delete these ${doomed.length}.`);
    return;
  }

  let deleted = 0;
  const failures = [];
  for (const [i, c] of doomed.entries()) {
    // Sequential + spaced: writes are what GitHub's secondary rate limit
    // watches, and ~100 back-to-back deletes is the shape that trips it.
    if (i > 0) await sleep(250);
    // encodeURIComponent is load-bearing: these names contain spaces and a "/".
    try {
      await api("DELETE", `/repos/${repo}/environments/${encodeURIComponent(c.name)}`);
      deleted += 1;
      console.log(`  deleted ${c.name} (PR #${c.pr})`);
    } catch (err) {
      failures.push(`${c.name}: ${err.message}`);
    }
  }

  console.log(`\ndeleted ${deleted}/${doomed.length}`);
  if (failures.length) {
    console.error("\nfailures:");
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

// Guarded so a test can import this file without firing real API calls.
// Node 22 has no import.meta.main, hence the argv comparison.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
