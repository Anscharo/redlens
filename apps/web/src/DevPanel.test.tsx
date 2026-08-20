// @vitest-environment jsdom
// DevPanel is the "__dev <cmd>" search-box easter egg. Its only real logic is
// the prefix filter, the "nothing matched" empty state, and resolving each
// shortcut's doc_no from loaded docs data (never hardcoded — see CLAUDE.md's
// UUID-vs-doc_no rule) — those are what's worth pinning here.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AtlasNode } from "@/types";

function node(id: string, doc_no: string): AtlasNode {
  return { id, doc_no, title: "", type: "Section", depth: 1, parentId: null, order: 0, content: "", addressRefs: [] };
}

const DOCS: Record<string, AtlasNode> = {
  "c7b2c565-d1b5-4239-9139-89762423443d": node(
    "c7b2c565-d1b5-4239-9139-89762423443d",
    "A.6.1.1.1.2.6.1.2.2.1.2.1.2.1.1.3.1",
  ),
  "50d68397-c09d-4f82-9e8b-44c2bcc30fd7": node("50d68397-c09d-4f82-9e8b-44c2bcc30fd7", "A.1.10.5.2.3.1"),
  "5f584db8-f8d8-4118-988c-b2bc3f68ceb7": node("5f584db8-f8d8-4118-988c-b2bc3f68ceb7", "A.1.6.1.5.0.6.1"),
};

let docsImpl: () => Promise<Record<string, AtlasNode>> = () => Promise.resolve(DOCS);

vi.mock("./lib/docs", () => ({
  loadDocs: () => docsImpl(),
}));

import { DevPanel } from "./DevPanel";

afterEach(() => {
  cleanup();
  docsImpl = () => Promise.resolve(DOCS);
  vi.restoreAllMocks();
});

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

  it("resolves each shortcut's doc_no from loaded docs data, not a hardcoded string", async () => {
    renderPanel("__dev deep");
    expect(
      await screen.findByText("A.6.1.1.1.2.6.1.2.2.1.2.1.2.1.1.3.1 · Encode Mint Function Call"),
    ).toBeInTheDocument();
  });

  it("still renders the shortcut (without a doc_no prefix) when docs fail to load", async () => {
    docsImpl = () => Promise.reject(new Error("boom"));
    renderPanel("__dev deep");
    expect(await screen.findByText("__deep")).toBeInTheDocument();
    expect(screen.getByText("Encode Mint Function Call")).toBeInTheDocument();
    expect(screen.queryByText(/A\.6\.1\.1\.1/)).toBeNull();
  });
});
