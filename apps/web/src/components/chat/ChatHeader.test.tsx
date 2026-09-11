// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ChatHeader } from "./ChatHeader";

function renderHeader(over: Partial<React.ComponentProps<typeof ChatHeader>> = {}) {
  const onNewChat = vi.fn();
  const onClose = vi.fn();
  const onTogglePlacement = vi.fn();
  const props = {
    title: null,
    onNewChat,
    onClose,
    placement: "float" as const,
    onTogglePlacement,
    ...over,
  };
  const utils = render(<ChatHeader {...props} />);
  return { ...utils, onNewChat, onClose, onTogglePlacement };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ChatHeader", () => {
  it("falls back to 'Atlas' when there is no conversation title", () => {
    renderHeader({ title: null });
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("shows the conversation title when set", () => {
    renderHeader({ title: "Budget rewards question" });
    expect(screen.getByText("Budget rewards question")).toBeInTheDocument();
  });

  it("calls onNewChat when New chat is clicked", () => {
    const { onNewChat } = renderHeader();
    fireEvent.click(screen.getByLabelText("New chat"));
    expect(onNewChat).toHaveBeenCalled();
  });

  it("links to the Conversations page from the left of the title", () => {
    renderHeader();
    const link = screen.getByLabelText("Conversations");
    expect(link).toHaveAttribute("href", "/conversations");
    expect(link.compareDocumentPosition(screen.getByText("Atlas")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("disables the Conversations button while already on that page", () => {
    const { hook } = memoryLocation({ path: "/conversations" });
    render(
      <Router hook={hook}>
        <ChatHeader title={null} onNewChat={null} onClose={vi.fn()} placement="float" onTogglePlacement={vi.fn()} />
      </Router>,
    );
    const btn = screen.getByLabelText("Conversations (this page)");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toBeDisabled();
    expect(screen.queryByLabelText("Conversations")).not.toBeInTheDocument();
  });

  it("renders no New chat button when onNewChat is null", () => {
    renderHeader({ onNewChat: null });
    expect(screen.queryByLabelText("New chat")).not.toBeInTheDocument();
  });

  it("calls onClose when Close is clicked", () => {
    const { onClose } = renderHeader();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a dock icon while floating; clicking it calls onTogglePlacement", () => {
    const { onTogglePlacement } = renderHeader({ placement: "float" });
    expect(screen.getByTitle("Dock to the side")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Dock to the side"));
    expect(onTogglePlacement).toHaveBeenCalled();
  });

  it("shows a float-out control while anchored", () => {
    renderHeader({ placement: "anchored" });
    expect(screen.getByTitle("Pop out to a floating window")).toBeInTheDocument();
  });
});
