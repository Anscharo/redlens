// Railway Infrastructure as Code for the Redline Portal project. The Railway CLI
// evaluates this file (`railway config plan` / `railway config apply`) under
// `node --experimental-strip-types`, so every relative import names its `.ts`.
// Railway does not read it during a deploy; a setting here reaches Railway only
// through `railway config apply`, once per environment. The steps are in
// docs/DEPLOYMENT.md ("Railway configuration").
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
//   - Every service names its GitHub repo, because a service without `source`
//     plans as disconnecting it. The source names no branch: github() would
//     add `branch: "main"`, and the branch each environment deploys (production,
//     development, the forked per-PR environments) stays as Railway has it.
import { defineRailway, project, service, type SourceConfig } from "railway/iac";

import { railwayWebWatchPatterns, railwayWorkerWatchPatterns } from "../scripts/lib/deploy-skip.ts";

/** Ownership name recorded on every resource this file declares. */
export const partial = "redlens";

// Service names as Railway shows them in each environment. A name that does
// not match plans as "Create service", never as a change to the existing one.
export const WEB_SERVICE = "redlens";

/** The worker is `redlens-worker` in production and `redlens worker` everywhere else. */
export function workerServiceName(environment: string | undefined): string {
  return environment === "production" ? "redlens-worker" : "redlens worker";
}

/** The repository both services deploy, spelled as Railway records it. */
const SOURCE: SourceConfig = { type: "github", repo: "Anscharo/redlens" };

/** The worker's cron period in minutes. The tail budget in atlas-worker.mjs stays under it. */
export const WORKER_CRON_MINUTES = 12;

// The web server. Its image is ./Dockerfile; the builder is pinned because
// Railpack's slim runtime cannot carry git, the build toolchain and the atlas
// clone the image build needs.
function webService() {
  return service(WEB_SERVICE, {
    source: SOURCE,
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
function workerService(name: string) {
  return service(name, {
    source: SOURCE,
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
export default defineRailway((ctx) => {
  const definition = {
    variables: { managed: false },
    resources: [webService(), workerService(workerServiceName(ctx.environment))],
  };
  return project("Redline Portal", definition);
});
