// @vitest-environment jsdom
// ConnectPage's tool list is loaded from public/tools.json (generated from
// src/server/tool-registry.ts by pnpm build:tools — src/lib/tools.ts) instead
// of the hand-mirrored array it used to hardcode, so it can't silently drift
// out of sync with the actual tool registry again.
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// src/lib/tools.ts caches its fetch in a module-level variable — reset the
// module registry per test so each test's fetch mock is actually exercised
// instead of reusing the previous test's cached result (same pattern as
// src/lib/glossary.test.ts).
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders the tool list fetched from tools.json, including newly-added tools", async () => {
  const tools = [
    { name: "atlas_search", desc: "Lexical / semantic / hybrid search over the whole atlas." },
    { name: "atlas_first_seen", desc: "Since when has this existed?" },
  ];
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(tools), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  const { ConnectPage } = await import("./ConnectPage");

  render(<ConnectPage />);

  const toolsList = await screen.findByRole("heading", { name: "Tools" }).then((h) => h.nextElementSibling as HTMLElement);
  await waitFor(() => expect(within(toolsList).getByText("atlas_first_seen")).toBeInTheDocument());
  expect(within(toolsList).getByText("atlas_search")).toBeInTheDocument();
  expect(screen.getByText(/should return the 2 tools/)).toBeInTheDocument();
  expect(within(toolsList).getByText("atlas_search")).toHaveClass("mcp-tool-name");
});

it("shows a fallback message if tools.json fails to load", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
  const { ConnectPage } = await import("./ConnectPage");

  render(<ConnectPage />);

  await waitFor(() => expect(screen.getByText("Couldn't load the tool list.")).toBeInTheDocument());
});
