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
    contextTokens: null,
    citationCount: 0,
    ...over,
  };
}

describe("ConversationCard", () => {
  it("renders the title and message count", () => {
    render(
      <ConversationCard conversation={conversation()} onOpen={() => {}} onViewCollection={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByText("My Conversation")).toBeInTheDocument();
    expect(screen.getByText("4 messages · 0 citations")).toBeInTheDocument();
  });

  it("appends the context size next to the message count when known", () => {
    render(
      <ConversationCard
        conversation={conversation({ contextTokens: 18200 })}
        onOpen={() => {}} onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("4 messages · 18.2k context · 0 citations")).toBeInTheDocument();
  });

  it("prefixes an estimated context size with ~", () => {
    render(
      <ConversationCard
        conversation={conversation({ contextTokens: 5200, contextEstimated: true })}
        onOpen={() => {}} onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("4 messages · ~5.2k context · 0 citations")).toBeInTheDocument();
  });

  it("omits the context size (no placeholder) when null", () => {
    render(
      <ConversationCard conversation={conversation({ contextTokens: null })} onOpen={() => {}} onViewCollection={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    expect(screen.getByText("4 messages · 0 citations")).toBeInTheDocument();
    expect(screen.queryByText(/context/)).toBeNull();
  });

  it("shows singular 'message' for a single-message conversation", () => {
    render(
      <ConversationCard
        conversation={conversation({ messageCount: 1 })}
        onOpen={() => {}} onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("1 message · 0 citations")).toBeInTheDocument();
  });

  it("falls back to 'Untitled chat' when title is null", () => {
    render(
      <ConversationCard
        conversation={conversation({ title: null })}
        onOpen={() => {}} onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("Untitled chat")).toBeInTheDocument();
  });

  it("clicking the row calls onOpen", () => {
    const onOpen = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onViewCollection={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("My Conversation"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("the row is keyboard-activatable (Enter opens)", () => {
    const onOpen = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onViewCollection={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    const row = screen.getByRole("button", { name: /open conversation/i });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onOpen).toHaveBeenCalled();
  });

  it("clicking Delete calls onDelete and does not call onOpen", () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onViewCollection={() => {}} onRename={() => {}} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clicking Rename reveals an input and does not call onOpen", () => {
    const onOpen = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={onOpen} onViewCollection={() => {}} onRename={() => {}} onDelete={() => {}} />,
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
      <ConversationCard conversation={conversation()} onOpen={onOpen} onViewCollection={() => {}} onRename={onRename} onDelete={() => {}} />,
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
      <ConversationCard conversation={conversation()} onOpen={() => {}} onViewCollection={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("My Conversation");
    expect(input).toHaveAttribute("maxLength", "48");
  });

  it("rename: Escape reverts the draft and does not call onRename", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <ConversationCard conversation={conversation()} onOpen={() => {}} onViewCollection={() => {}} onRename={onRename} onDelete={() => {}} />,
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
      <ConversationCard conversation={conversation()} onOpen={() => {}} onViewCollection={() => {}} onRename={onRename} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("My Conversation");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });
  it("shows the citation count after the message and context counts, singular for one", () => {
    const { rerender } = render(
      <ConversationCard
        conversation={conversation({ contextTokens: 18200, citationCount: 7 })}
        onOpen={() => {}}
        onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("4 messages · 18.2k context · 7 citations")).toBeInTheDocument();
    rerender(
      <ConversationCard
        conversation={conversation({ citationCount: 1 })}
        onOpen={() => {}}
        onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("4 messages · 1 citation")).toBeInTheDocument();
  });

  it("View Doc Collection calls onViewCollection and does not open the chat", () => {
    const onOpen = vi.fn();
    const onViewCollection = vi.fn();
    render(
      <ConversationCard
        conversation={conversation({ citationCount: 3 })}
        onOpen={onOpen}
        onViewCollection={onViewCollection}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View Doc Collection" }));
    expect(onViewCollection).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("disables View Doc Collection when the conversation cites nothing", () => {
    const onViewCollection = vi.fn();
    render(
      <ConversationCard
        conversation={conversation({ citationCount: 0 })}
        onOpen={() => {}}
        onViewCollection={onViewCollection}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "View Doc Collection" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onViewCollection).not.toHaveBeenCalled();
  });

  it("puts View Doc Collection and the right-aligned Rename/Delete in one row", () => {
    render(
      <ConversationCard
        conversation={conversation({ citationCount: 3 })}
        onOpen={() => {}}
        onViewCollection={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    const view = screen.getByRole("button", { name: "View Doc Collection" });
    const rename = screen.getByRole("button", { name: "Rename" });
    const group = rename.parentElement!;
    expect(group).toContainElement(screen.getByRole("button", { name: "Delete" }));
    expect(group).toHaveClass("ml-auto");
    expect(view.parentElement).toBe(group.parentElement);
  });
});
