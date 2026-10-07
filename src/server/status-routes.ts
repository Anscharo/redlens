import { config } from "./config.ts";
import { CORS } from "./http.ts";
import { registerSSEClient, sseClientCount } from "./sse.ts";
import { evaluateFreshness, freshnessHttpStatus } from "./history/freshness.ts";

// Liveness: always 200 while the process is up, so staleness never restart-loops
// a healthy container. rss_mb is a load-test canary and never fails health.
export async function handleHealth(): Promise<Response> {
  const f = await evaluateFreshness();
  return Response.json(
    {
      status: f.status,
      atlas_sha: f.liveSha,
      db_sha: f.dbSha,
      age_seconds: f.ageSeconds,
      schema: f.schemaVersion,
      required_schema: f.requiredSchema,
      db_reachable: f.dbReachable,
      docs: f.docs,
      // Lets the frontend compare its build-time commit and detect a stale bundle.
      app_commit: config.appCommit || null,
      rss_mb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      sse_clients: sseClientCount(),
    },
    { headers: CORS },
  );
}

// Status-coded for an external uptime monitor: 200 when ok or converging,
// 503 when stale, schema-behind or DB unreachable.
export async function handleFreshness(): Promise<Response> {
  const f = await evaluateFreshness();
  return Response.json(f, { status: freshnessHttpStatus(f.status), headers: CORS });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
  ...CORS,
};

function atlasEventStream(): ReadableStream {
  let unregister: (() => void) | null = null;
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const enqueue = (s: string) => controller.enqueue(enc.encode(s));
      unregister = registerSSEClient(enqueue, () => controller.close());
    },
    cancel() { unregister?.(); },
  });
}

// SSE stream of atlas-update events. The capacity check runs before any stream
// is built; useAtlasVersion's EventSource gives up on a failed first connection,
// so a rejection here cannot trigger a reconnect storm.
export function handleAtlasEvents(): Response {
  if (sseClientCount() >= config.sseMaxClients) {
    return Response.json(
      { error: "sse_capacity", message: "Too many live-update connections open right now." },
      { status: 503, headers: { "Retry-After": "30", ...CORS } },
    );
  }
  return new Response(atlasEventStream(), { headers: SSE_HEADERS });
}
