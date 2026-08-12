// @vitest-environment jsdom
// DevPanel is the "__dev <cmd>" search-box easter egg. Its only real logic is
// the prefix filter and the "nothing matched" empty state — everything else
// is static rows — so those are what's worth pinning here.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DevPanel } from "./DevPanel";

afterEach(() => cleanup());

function renderPanel(query: string) {
  const { hook } = memoryLocation({ path: "/", record: true });
  return render(
    <Router hook={hook}>
      <DevPanel query={query} />
    </Router>,
  );
}

describe("DevPanel", () => {
  it("lists every shortcut when the query is just '__dev' with no filter text", () => {
    renderPanel("__dev");
    expect(screen.getByText("__deep")).toBeInTheDocument();
    expect(screen.getByText("__notes")).toBeInTheDocument();
    expect(screen.getByText("__history")).toBeInTheDocument();
  });

  it("filters to shortcuts whose command starts with the typed text", () => {
    renderPanel("__dev de");
    expect(screen.getByText("__deep")).toBeInTheDocument();
    expect(screen.queryByText("__notes")).toBeNull();
    expect(screen.queryByText("__history")).toBeNull();
  });

  it("matches case-insensitively", () => {
    renderPanel("__dev DE");
    expect(screen.getByText("__deep")).toBeInTheDocument();
  });

  it("renders nothing when no shortcut matches the filter", () => {
    const { container } = renderPanel("__dev zzz");
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("dev shortcuts")).toBeNull();
  });

  it("links each shortcut to its atlas node id", () => {
    renderPanel("__dev deep");
    expect(screen.getByRole("link", { name: /__deep/ })).toHaveAttribute(
      "href",
      "/atlas?id=c7b2c565-d1b5-4239-9139-89762423443d",
    );
  });
});
