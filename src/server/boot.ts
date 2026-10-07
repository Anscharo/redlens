import { config } from "./config.ts";
import { loadIndexes } from "./retrieval/indexes.ts";
import { pinBundleSha } from "./bundle-store.ts";
import { startUpdater, startBootEmbeddings } from "./atlas-updater.ts";
import { sql, waitForDb } from "./db.ts";
import { runMigrations } from "./migrate.ts";
import { shutdownPosthog } from "./posthog-node.ts";
import { serverAnalyticsEnabled } from "./posthog-capture.ts";
import { checkAuthConfig } from "./check-auth-config.ts";
import { buildRoutes } from "./routes.ts";
import { handleRequest } from "./request-handler.ts";
import { seedDbIfEmpty } from "./seed-db.ts";

// Everything boot needs from the outside world, injected so the sequence runs
// without a socket, Postgres or a subprocess. Only tests pass anything but realBootDeps.
export interface BootDeps {
  loadIndexes: () => { docMap: Map<string, unknown>; entities: unknown[]; edges: unknown[]; meta: Record<string, string | null> };
  serve: (opts: { port: number; idleTimeout: number; routes: ReturnType<typeof buildRoutes>; fetch: typeof handleRequest }) => { port: number | string };
  onSignal: (sig: NodeJS.Signals, handler: () => void) => void;
  waitForDb: () => Promise<void>;
  runMigrations: () => Promise<string[]>;
  query: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>;
  spawnSync: () => { exited: Promise<number> };
  startBootEmbeddings: () => void;
  startUpdater: () => void;
  startPreviewSweeper: () => Promise<void>;
}

const realBootDeps: BootDeps = {
  loadIndexes,
  serve: (opts) => Bun.serve(opts as Parameters<typeof Bun.serve>[0]) as unknown as { port: number | string },
  onSignal: (sig, handler) => void process.once(sig, handler),
  waitForDb,
  runMigrations,
  query: (strings, ...values) => sql(strings, ...values) as unknown as Promise<Array<Record<string, unknown>>>,
  spawnSync: () => Bun.spawn(["bun", "src/server/sync.ts"], { stdout: "inherit", stderr: "inherit", env: { ...process.env } }),
  startBootEmbeddings,
  startUpdater,
  // Not exercised for real: it would leave a live sweep interval in the test
  // process. index-boot.test.ts asserts boot() calls it; sweeper.test.ts covers it.
  startPreviewSweeper: async () => {
    const { startPreviewSweeper } = await import("./preview/sweeper.ts");
    startPreviewSweeper();
    // Fills diff-base columns on rows built before they existed; a no-op once complete.
    const { startPreviewDiffBaseBackfill } = await import("./preview/diff-base-backfill.ts");
    startPreviewDiffBaseBackfill();
  },
};

function loadAndPinIndexes(deps: BootDeps): void {
  const t0 = performance.now();
  const ix = deps.loadIndexes();
  // Keeps the bundle being served from LRU eviction (see bundle-store.ts's pinnedSha).
  pinBundleSha(ix.meta.atlasCommit ?? null);
  console.log(
    `indexes: ${ix.docMap.size} docs, ${ix.entities.length} entities, ${ix.edges.length} edges ` +
      `(${Math.round(performance.now() - t0)}ms)`,
  );
}

async function warnOnMisconfig(): Promise<void> {
  checkAuthConfig();
  // POSTHOG_KEY is a runtime variable and every server-side capture no-ops without it.
  if (!serverAnalyticsEnabled) {
    console.warn("⚠️  POSTHOG_KEY unset — server-side analytics disabled (mcp_tool_call, $ai_generation, chat error capture)");
  }
  // Dynamic import of an already-loaded module; the decision itself is tested in canonical.test.ts.
  const { canonicalRedirectBootLog } = await import("./history/canonical.ts");
  const bootLine = canonicalRedirectBootLog(config);
  if (bootLine) console.warn(bootLine);
}

// Flushes batched PostHog events on SIGTERM so a redeploy keeps the last window.
function flushPosthogOnSignal(deps: BootDeps): void {
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    deps.onSignal(sig, () => {
      void shutdownPosthog().finally(() => process.exit(0));
    });
  }
}

// Boot is driven with fakes in index-boot.test.ts. The DB seed is not awaited so it never delays serving.
export async function boot(deps: BootDeps = realBootDeps): Promise<void> {
  loadAndPinIndexes(deps);
  await warnOnMisconfig();
  const server = deps.serve({ port: config.port, idleTimeout: 120, routes: buildRoutes(), fetch: handleRequest });
  console.log(`listening on :${server.port}  (mcp: POST ${config.mcpPath})`);
  flushPosthogOnSignal(deps);
  void seedDbIfEmpty(deps);
  deps.startBootEmbeddings();
  deps.startUpdater(); // ATLAS_UPDATE_ENABLED=0 disables
  void deps.startPreviewSweeper();
}
