// Railway Infrastructure as Code for the Redline Atlas project. The Railway CLI
// evaluates this file (`railway config plan` / `railway config apply`) under
// `node --experimental-strip-types`, so every relative import names its `.ts`.
// Railway does not read it during a deploy; a setting here reaches Railway only
// through an apply, run from the manual "Railway config" workflow
// (.github/workflows/railway-config.yml) or a local CLI. The rollout steps are
// in docs/DEPLOYMENT.md ("Railway configuration").
//
// It manages the two services built from this repository and nothing else:
//
//   - `partial` makes this a named slice of the environment. The CLI deletes
//     only resources a partial owns, so the Postgres service, its volume and
//     anything else added in the dashboard are never touched by an apply,
//     although this file does not declare them.
//   - `variables.managed: false` leaves every service variable to the
//     dashboard (docs/railway-env-vars.md). Secrets never enter the repo, and a
//     variable missing from this file is not a variable to delete.
//   - No `source`: the services keep the GitHub repo and branch Railway already
//     deploys, which differs between production, development and the forked
//     per-PR environments.
import { defineRailway, project, service } from "railway/iac";

import { railwayWebWatchPatterns, railwayWorkerWatchPatterns } from "../scripts/lib/deploy-skip.ts";

/** Ownership name recorded on every resource this file declares. */
export const partial = "redlens";

// Service names as Railway shows them. A name that does not match plans as
// "Create service", never as a change to the existing one.
export const WEB_SERVICE = "redlens-atlas";
export const WORKER_SERVICE = "redlens-worker";

/** The worker's cron period in minutes. The tail budget in atlas-worker.mjs stays under it. */
export const WORKER_CRON_MINUTES = 12;

// The web server. Its image is ./Dockerfile; the builder is pinned because
// Railpack's slim runtime cannot carry git, the build toolchain and the atlas
// clone the image build needs.
function webService() {
  return service(WEB_SERVICE, {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
      // Markdown the app does not bundle skips the deploy (scripts/lib/deploy-skip.ts).
      watchPatterns: railwayWebWatchPatterns(),
    },
    deploy: {
      startCommand: "bun --silent run start",
      // /api/health is always-200 liveness (see src/server/status-routes.ts), so a rollout
      // waits for readiness rather than an open port, which bounds the window in
      // which two builds serve concurrently.
      healthcheckPath: "/api/health",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
  });
}

// The atlas worker: a cron service that builds the atlas, syncs every Postgres
// table and exits. Its image is ./Dockerfile.worker (full atlas clone, gh CLI,
// no frontend). Its variables, the PR-environment gate included, are described
// in docs/DEPLOYMENT.md step 4.
function workerService() {
  return service(WORKER_SERVICE, {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.worker",
      // No markdown, and nothing under apps/web but its manifest.
      watchPatterns: railwayWorkerWatchPatterns(),
    },
    deploy: {
      // A tick with nothing new exits at once.
      cronSchedule: `*/${WORKER_CRON_MINUTES} * * * *`,
      startCommand: "bun scripts/required/atlas-worker.mjs",
    },
  });
}

// `variables` is read by the CLI (it is what `railway config migrate
// --variables=unmanaged` writes) but is not yet in the SDK's ProjectDefinition
// type, so the definition is built outside the call to skip the
// excess-property check.
export default defineRailway(() => {
  const definition = {
    variables: { managed: false },
    resources: [webService(), workerService()],
  };
  return project("Redline Atlas", definition);
});
