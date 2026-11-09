import { test, expect } from "bun:test";
import { withEnvironment } from "./posthog-environment.ts";
import { openrouterEnvironment } from "./openrouter-attribution.ts";

test("withEnvironment fills a missing environment and keeps one the caller set", () => {
  expect(withEnvironment({ event: "$mcp_tool_call" })?.properties?.environment).toBe(openrouterEnvironment());
  expect(withEnvironment({ event: "x", properties: { environment: "eval", a: 1 } })?.properties).toEqual({
    environment: "eval",
    a: 1,
  });
  expect(withEnvironment(null)).toBeNull();
});
