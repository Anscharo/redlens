# PostHog MCP Analytics — Integration Report

## Summary

The MCP server (`src/server/mcp.ts`) has been instrumented with the `@posthog/mcp` SDK. Every tool call, tools-list, and initialize handshake handled by the server now emits standard `$mcp_*` events in PostHog alongside the existing custom `mcp_tool_call` events already in place.

**Path used:** Path A — official SDK `McpServer` (`@modelcontextprotocol/sdk`), wrapped with `instrument(server, posthog)`.

---

## Changes made

### New dependency

- `@posthog/mcp@0.9.1` added to `dependencies` in `package.json`. Pre-1.0 beta — pin the version and watch for breaking changes in minor `0.x` releases.

### Modified files

| File | Change |
|------|--------|
| `src/server/mcp.ts` | Added `import { instrument } from "@posthog/mcp"` and `import { getPosthog } from "./posthog-node.ts"`. Calls `instrument(server, posthog)` immediately after constructing the `McpServer`, guarded by `if (posthog)` so it's a no-op when `POSTHOG_KEY` is absent. |
| `.env.local` | Added `POSTHOG_KEY` and `POSTHOG_HOST` (both were missing; the key is the same `phc_…` token already used for `VITE_POSTHOG_KEY`). |
| `package.json` | `@posthog/mcp@0.9.1` added to dependencies by pnpm. |
| `pnpm-lock.yaml` | Updated by pnpm install. |

### How it fits with existing analytics

The project already captures a custom `mcp_tool_call` event per request (via `captureServerEvent` in `posthog-capture.ts`). The new `instrument()` wrapper adds the standard `$mcp_*` event family on top:

- `$mcp_tool_call` — per tool invocation (structured, with duration + error flag)
- `$mcp_tools_list` — per `tools/list` response
- `$mcp_initialize` — per client handshake
- `$exception` — whenever a tool throws or returns `isError: true`

These events use the PostHog-defined schema documented at https://posthog.com/docs/mcp-analytics — enabling the standard MCP analytics dashboard without any additional configuration.

The existing `mcp_tool_call` custom event is preserved unchanged.

### Shutdown / flush

The existing `process.once("SIGTERM" / "SIGINT", () => shutdownPosthog())` handler in `src/server/index.ts` already drains the shared `posthog-node` client. Since `instrument()` uses that same client (`getPosthog()`), MCP analytics events are flushed on redeploy/SIGTERM with no additional code needed.

---

## Next steps

1. **Deploy or restart the server** — `POSTHOG_KEY` and `POSTHOG_HOST` are now set in `.env.local` for local dev. For Railway production, ensure `POSTHOG_KEY=phc_nsNQimsmLLdXxiNCHZHR5kTbRYYCX6ipXMRWk2yvwiFV` is set as a service variable (it likely already is, since LLM observability via `posthog-node.ts` was previously wired).

2. **Verify events** — after the first MCP request, check the PostHog [Live Events](https://us.posthog.com/project/435638/activity/explore) view for `$mcp_tool_call` events.

3. **Dashboard** — see https://posthog.com/docs/mcp-analytics for the standard MCP analytics dashboard template.

4. **Beta SDK** — `@posthog/mcp` is pre-1.0. Review the changelog before upgrading past `0.9.1`.
