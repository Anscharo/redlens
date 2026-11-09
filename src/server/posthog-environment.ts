// Every event the posthog-node client sends carries `environment` ("production",
// a PR environment's name, "development", "local" or "eval"), so PostHog's
// test-account filter can drop test traffic. Events that the @posthog/mcp and
// @posthog/ai wrappers build have no hook of their own, so the client's
// before_send (posthog-node.ts) is the one place that reaches them. A value the
// caller set already is kept.
import type { EventMessage } from "posthog-node";
import { openrouterEnvironment } from "./openrouter-attribution.ts";

export function withEnvironment(event: EventMessage | null): EventMessage | null {
  if (!event || event.properties?.environment != null) return event;
  return { ...event, properties: { ...event.properties, environment: openrouterEnvironment() } };
}
