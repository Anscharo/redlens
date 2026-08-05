// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationCard } from "./ConversationCard";
import type { ConversationSummary } from "../../lib/conversationsApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function conversation(over: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "c1",
    title: "My Conversation",
    updatedAt: "2026-01-15T00:00:00.000Z",
    messageCount: 4,
    ...over,
  };
}

describe("ConversationCard", () => {
  it("renders the title and message count", () => {
    render(
      <ConversationCard conversation={conversation()} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByText("My Conversation")).toBeInTheDocument();
    expect(screen.getByText("4 messages")).toBeInTheDocument();
  });

  it("shows singular 'message' for a single-message conversation", () => {
    render(
      <ConversationCard
        conversation={conversation({ messageCount: 1 })}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("1 message")).toBeInTheDocument();
  });

  it("falls back to 'Untitled chat' when title is null", () => {
    render(
      <ConversationCard
        conversation={conversation({ title: null })}
        onOpen={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("Untitled chat")).toBeInTheDocument();
  });

  it("clicking the row calls onOpen", () => {
    const onOpen = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onRename={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("My Conversation"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("the row is keyboard-activatable (Enter opens)", () => {
    const onOpen = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onRename={() => {}} onDelete={() => {}} />,
    );
    const row = screen.getByRole("button", { name: /open conversation/i });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalled();
  });

  it("clicking Delete calls onDelete and does not call onOpen", () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onRename={() => {}} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clicking Rename reveals an input and does not call onOpen", () => {
    const onOpen = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onRename={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("Rename"));
    expect(screen.getByDisplayValue("My Conversation")).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("rename: typing and pressing Enter commits an optimistic rename via onRename, without calling onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onRename = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onRename={onRename} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("My Conversation");
    await user.clear(input);
    await user.type(input, "New Name{Enter}");
    expect(onRename).toHaveBeenCalledWith("New Name");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("rename input enforces MAX_CONVERSATION_TITLE_LEN via maxLength", () => {
    render(
      <ConversationCard conversation={conversation()} onOpen={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("My Conversation");
    expect(input).toHaveAttribute("maxLength", "48");
  });

  it("rename: Escape reverts the draft and does not call onRename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    await user.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("My Conversation");
    await user.type(input, " extra{Escape}");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("My Conversation")).toBeInTheDocument();
  });

  it("rename: blurring with an unchanged (whitespace-only) value does not call onRename", () => {
    const onRename = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("My Conversation");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });
});
