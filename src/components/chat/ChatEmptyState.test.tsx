// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PageContextView } from "./pageContext";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../lib/analytics", () => ({ track }));

const { listConversations } = vi.hoisted(() => ({ listConversations: vi.fn() }));
vi.mock("../../lib/conversationsApi", () => ({ listConversations }));

import { ChatEmptyState } from "./ChatEmptyState";

const baseContext: PageContextView = {
  short: "Ask the Sky Atlas",
  placeholder: "Ask about the Sky Atlas…",
  label: "Sky Atlas",
  chip: "atlas",
};

function renderEmpty(over: { authed?: boolean; context?: PageContextView } = {}) {
  const onSend = vi.fn();
  const onOpenConversation = vi.fn();
  const props = {
    authed: over.authed ?? true,
    context: over.context ?? baseContext,
    onSend,
    onOpenConversation,
  };
  const utils = render(<ChatEmptyState {...props} />);
  return { ...utils, onSend, onOpenConversation };
}

beforeEach(() => {
  listConversations.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatEmptyState greeting + starters", () => {
  it("renders the generic greeting and starters on a non-report page", () => {
    listConversations.mockResolvedValue([]);
    renderEmpty();
    expect(screen.getByText("Ask the Atlas")).toBeInTheDocument();
    expect(screen.getByText("Trace the governance path for an Atlas amendment.")).toBeInTheDocument();
  });

  it("shows report-flavored copy and starters on a report page", () => {
    listConversations.mockResolvedValue([]);
    renderEmpty({ context: { ...baseContext, reportName: "Rewards", reportTool: "atlas_report_rewards" } });
    expect(screen.getByText("Viewing the Rewards report")).toBeInTheDocument();
    expect(screen.getByText("Summarize the Rewards report.")).toBeInTheDocument();
  });

  it("calls onSend with the starter text and tracks the click", () => {
    listConversations.mockResolvedValue([]);
    const { onSend } = renderEmpty();
    fireEvent.click(screen.getByText("Trace the governance path for an Atlas amendment."));
    expect(onSend).toHaveBeenCalledWith("Trace the governance path for an Atlas amendment.");
    expect(track).toHaveBeenCalledWith("chat_starter_click", { product: "chat", starter: 2 });
  });
});

describe("ChatEmptyState continue a previous chat", () => {
  it("renders the recent list, capped at 3, once loaded", async () => {
    listConversations.mockResolvedValue([
      { id: "c1", title: "First", updatedAt: "2026-01-01T00:00:00Z", messageCount: 2 },
      { id: "c2", title: "Second", updatedAt: "2026-01-02T00:00:00Z", messageCount: 2 },
      { id: "c3", title: null, updatedAt: "2026-01-03T00:00:00Z", messageCount: 2 },
      { id: "c4", title: "Fourth", updatedAt: "2026-01-04T00:00:00Z", messageCount: 2 },
    ]);
    renderEmpty();
    await waitFor(() => expect(screen.getByText("First")).toBeInTheDocument());
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("Untitled chat")).toBeInTheDocument(); // c3's null title
    expect(screen.queryByText("Fourth")).toBeNull(); // capped at 3
    expect(screen.getByText("See all conversations →")).toBeInTheDocument();
  });

  it("clicking a recent entry calls onOpenConversation with its id and title, and tracks it", async () => {
    listConversations.mockResolvedValue([{ id: "c1", title: "First", updatedAt: "2026-01-01T00:00:00Z", messageCount: 2 }]);
    const { onOpenConversation } = renderEmpty();
    await waitFor(() => expect(screen.getByText("First")).toBeInTheDocument());
    fireEvent.click(screen.getByText("First"));
    expect(onOpenConversation).toHaveBeenCalledWith("c1", "First");
    expect(track).toHaveBeenCalledWith("chat_conversation_open", { product: "chat", source: "empty_state" });
  });

  it("renders no error and no section when the list request fails", async () => {
    listConversations.mockRejectedValue(new Error("network down"));
    renderEmpty();
    await waitFor(() => expect(listConversations).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("See all conversations →")).toBeNull();
    // Starters are still there — the failure is additive-only, not a fatal error.
    expect(screen.getByText("Ask the Atlas")).toBeInTheDocument();
  });

  it("renders no section when the list is empty", async () => {
    listConversations.mockResolvedValue([]);
    renderEmpty();
    await waitFor(() => expect(listConversations).toHaveBeenCalled());
    expect(screen.queryByText("See all conversations →")).toBeNull();
  });

  it("does not fetch the recent list when signed out", () => {
    renderEmpty({ authed: false });
    expect(listConversations).not.toHaveBeenCalled();
  });
});
