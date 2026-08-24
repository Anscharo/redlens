#!/usr/bin/env node
// The always-reported required check for E2E — "required to pass, but only if
// it wasn't skipped".
//
// The suite itself (.github/workflows/e2e.yml) is driven by `deployment_status`,
// which Railway only emits once a PR environment finishes deploying. And
// railway.toml's watchPatterns deliberately skip that deploy for PRs that only
// touch markdown the app does not `?raw`-import (skills, CLAUDE.md, plans). No
// deploy means no event, which means e2e.yml never runs and never reports a
// check at all — and GitHub has no "required only if it ran" setting. An
// unreported required check is never satisfied, so a docs-only PR sits on
// "Expected — Waiting for status to be reported" forever.
//
// The requirement therefore lives here instead: a job that runs on
// `pull_request`, so it is always reported, and that decides the same question
// e2e.yml's inline gate does — but reports an answer either way:
//
//   markdown-only diff -> pass immediately. Nothing will deploy, so there is
//                         nothing for E2E to verify.
//   anything else      -> wait for a run of e2e.yml at this head SHA and mirror
//                         its verdict.
//
// Runs are matched by WORKFLOW FILE, never by job name. Two reasons, both real:
// Railway emits a deployment_status per service and per environment, so a single
// commit gets several e2e.yml runs (the ones for non-PR environments conclude
// `skipped` at the job-level `if:`); and this job carries the required check's
// own name, so name-matching would make it find itself and pass instantly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shouldSkipDeploy } from "../lib/deploy-skip.mjs";

// When imported by the test rather than run as a CLI, only the pure helpers
// load — the polling main block below is skipped.
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

/** Conclusions that mean the suite ran and rejected the commit. */
export const FAILED_CONCLUSIONS = Object.freeze(["failure", "timed_out", "startup_failure"]);

/**
 * Neither a pass nor a fail:
 *   skipped   — job-level `if:` said this deployment_status is not a PR env.
 *   cancelled — a newer deploy of the same commit superseded this run
 *               (e2e.yml's concurrency group is cancel-in-progress).
 * Both are "keep waiting for a run that actually tests the app".
 */
export const INCONCLUSIVE_CONCLUSIONS = Object.freeze(["skipped", "cancelled", "neutral", "stale"]);

/**
 * Fold every e2e.yml run for one commit into a single verdict.
 *
 * A success anywhere wins over a failure, so re-running the suite (or a newer
 * deploy of the same commit) clears an earlier red without anyone also having
 * to re-run this gate. A failure only settles the verdict once nothing is still
 * in flight — otherwise a run that failed while a newer one is mid-deploy would
 * report red for a commit that is about to go green.
 */
export function classifyRuns(runs) {
  const list = (Array.isArray(runs) ? runs : []).filter(Boolean);
  const completed = list.filter((r) => r.status === "completed");
  const pending = list.filter((r) => r.status !== "completed");

  if (completed.some((r) => r.conclusion === "success")) {
    return { verdict: "pass", reason: "E2E passed for this commit" };
  }
  const failed = completed.filter((r) => FAILED_CONCLUSIONS.includes(r.conclusion));
  if (failed.length && !pending.length) {
    return {
      verdict: "fail",
      reason: `E2E concluded ${failed.map((r) => r.conclusion).join(", ")} for this commit`,
      runUrl: failed[failed.length - 1].html_url,
    };
  }
  if (pending.length) {
    return { verdict: "wait", reason: `${pending.length} E2E run(s) still in flight` };
  }
  if (failed.length) {
    return { verdict: "wait", reason: "E2E failed but a newer run is expected" };
  }
  if (completed.length) {
    return {
      verdict: "wait",
      reason: `no E2E run has tested this commit yet (${completed.map((r) => r.conclusion ?? "?").join(", ")})`,
    };
  }
  return { verdict: "wait", reason: "waiting for Railway to deploy this commit" };
}

/** Repo-relative paths from the file the workflow wrote, or [] if unreadable. */
export function readChangedFiles(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRuns({ apiBase, repo, workflow, sha, token }) {
  const url = `${apiBase}/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "redlens-e2e-gate",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
  const body = await res.json();
  return Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
}

function summarize(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${lines.join("\n")}\n`);
  } catch {
    // A summary is a nicety; never let it decide the gate.
  }
}

if (isMain) {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.HEAD_SHA;
  if (!repo || !sha) {
    console.error("GITHUB_REPOSITORY and HEAD_SHA are required");
    process.exit(1);
  }

  const changedFile = process.env.CHANGED_FILES_FILE ?? "changed-files.txt";
  const changed = readChangedFiles(changedFile);
  // shouldSkipDeploy() treats an empty list as "not a skip", which is the same
  // fail-open posture ci.yml's `changes` job takes: an unreadable diff must run
  // the gate, never bypass it.
  if (shouldSkipDeploy(changed)) {
    const msg = `E2E skipped: all ${changed.length} changed path(s) are markdown the app does not read.`;
    console.log(msg);
    console.log(changed.map((f) => `  ${f}`).join("\n"));
    summarize([`### E2E gate`, "", `✅ ${msg}`, "", "Railway skips the deploy for this diff, so there is nothing to test."]);
    process.exit(0);
  }

  console.log(
    changed.length
      ? `${changed.length} changed path(s) are deploy-relevant; waiting for E2E at ${sha}.`
      : `could not read a changed-file list from '${changedFile}'; failing open and waiting for E2E at ${sha}.`,
  );

  const apiBase = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
  const workflow = process.env.E2E_WORKFLOW_FILE ?? "e2e.yml";
  const token = process.env.GITHUB_TOKEN || "";
  // Guarded: a garbage override must not turn the poll loop into a busy loop
  // hammering the API, which is what an unchecked NaN interval would do.
  const num = (raw, fallback) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const pollSeconds = num(process.env.E2E_GATE_POLL_SECONDS, 30);
  const timeoutSeconds = num(process.env.E2E_GATE_TIMEOUT_SECONDS, 2400);
  const deadline = Date.now() + timeoutSeconds * 1000;

  let last = "";
  let result = { verdict: "wait", reason: "no poll completed" };
  while (Date.now() < deadline) {
    try {
      result = classifyRuns(await fetchRuns({ apiBase, repo, workflow, sha, token }));
    } catch (err) {
      // A flaky API read must not decide the gate — log once and keep polling
      // until the deadline, which is the same outcome as "no run yet".
      result = { verdict: "wait", reason: `GitHub API read failed: ${err.message}` };
    }
    if (result.verdict !== "wait") break;
    if (result.reason !== last) {
      console.log(`waiting: ${result.reason}`);
      last = result.reason;
    }
    await sleep(pollSeconds * 1000);
  }

  if (result.verdict === "pass") {
    console.log(result.reason);
    summarize(["### E2E gate", "", `✅ ${result.reason}.`]);
    process.exit(0);
  }

  const detail =
    result.verdict === "fail"
      ? `❌ ${result.reason}.${result.runUrl ? ` See ${result.runUrl}` : ""}`
      : `❌ Gave up after ${timeoutSeconds >= 120 ? `${Math.round(timeoutSeconds / 60)} minutes` : `${timeoutSeconds}s`} — ${result.reason}.`;
  console.error(detail);
  summarize([
    "### E2E gate",
    "",
    detail,
    "",
    result.verdict === "fail"
      ? "Re-run this job after the E2E workflow goes green — it reads the suite's verdict, it does not cache one."
      : "Either the Railway PR environment never deployed this commit, or its deploy is still running. Check the PR environment, then re-run this job.",
  ]);
  process.exit(1);
}
