// posthog-node client for server-side LLM observability. The @posthog/ai OpenAI
// wrapper (see llm.ts) captures one `$ai_generation` event per completion — model,
// token counts, latency, cost estimate, trace id — and needs the batching
// posthog-node SDK to ship them.
//
// This is deliberately separate from the two other server-side PostHog paths:
//   - posthog-capture.ts — hand-rolled, no-SDK, anonymous MCP tool-usage capture
//   - posthog-proxy.ts   — first-party reverse proxy for browser (posthog-js) traffic
// AI observability wants per-user attribution (distinct_id = signed-in user) and the
// SDK's generation-event schema, which the minimal anonymous capture path avoids on
// purpose — so it gets its own client rather than bending either of those.
//
// Same non-secret POSTHOG_KEY as posthog-capture.ts (PostHog has no separate server
// key). Absent → getPosthog() returns null and llm.ts falls back to the plain,
// un-instrumented OpenAI client — a silent no-op, never an error.
import { PostHog } from "posthog-node";

const KEY = process.env.POSTHOG_KEY ?? "";
const HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

// undefined = not yet resolved; null = resolved-but-disabled (no key). The tri-state
// lets a keyless process cache the "off" decision instead of re-checking each call.
let client: PostHog | null | undefined;

export function getPosthog(): PostHog | null {
  if (client !== undefined) return client;
  client = KEY ? new PostHog(KEY, { host: HOST }) : null;
  return client;
}

// Flush any batched events on shutdown so a redeploy/SIGTERM doesn't drop the last
// window of generations. Safe to call when disabled (no client) — it no-ops.
export async function shutdownPosthog(): Promise<void> {
  if (client) await client.shutdown();
}

// Shared correlation context for the error/degradation capture helpers below.
// traceId is the join key back to a turn's $ai_generation events (see llm.ts) —
// always fold it in so an error can be found alongside the completions it broke.
export interface ErrorContext {
  distinctId?: string;
  traceId?: string;
  properties?: Record<string, unknown>;
}

function withTrace(ctx: ErrorContext, extra?: Record<string, unknown>): Record<string, unknown> {
  return { ...(ctx.traceId ? { $ai_trace_id: ctx.traceId } : {}), ...ctx.properties, ...extra };
}

// Best-effort exception capture for internal failures the chat harness
// deliberately swallows to keep a turn alive (verifier/advisor transport
// errors, tool handler crashes, revision-loop failures). No-op when
// POSTHOG_KEY is unset, same silent-disable as getPosthog().
export function captureError(error: unknown, ctx: ErrorContext = {}, extra?: Record<string, unknown>): void {
  getPosthog()?.captureException(error, ctx.distinctId, withTrace(ctx, extra));
}

// Best-effort event capture for silent DEGRADATIONS that aren't exceptions —
// a judge/advisor call succeeded but returned unparseable JSON, so the turn
// falls back to "unverified"/"annotate" with no other record it happened.
export function captureEvent(event: string, ctx: ErrorContext = {}, properties?: Record<string, unknown>): void {
  const ph = getPosthog();
  if (!ph) return;
  ph.capture({ distinctId: ctx.distinctId ?? "server", event, properties: withTrace(ctx, properties) });
}
