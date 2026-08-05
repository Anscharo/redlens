// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConversationsPage } from "./ConversationsPage";
import type { ConversationSummary } from "../../lib/conversationsApi";

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  conversations: [] as ConversationSummary[],
  loading: false,
  error: null as string | null,
  rename: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  openChat: vi.fn(),
  notifyDeleted: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../chat/auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../chat/SignInButtons", () => ({
  SignInButtons: () => <div data-testid="signin-buttons" />,
}));
vi.mock("../../hooks/useConversations", () => ({
  useConversations: () => ({
    conversations: mocks.conversations,
    loading: mocks.loading,
    error: mocks.error,
    rename: mocks.rename,
    remove: mocks.remove,
  }),
}));
vi.mock("../../lib/chatOpen", () => ({
  useChatOpen: () => ({ openChat: mocks.openChat, notifyDeleted: mocks.notifyDeleted }),
}));
vi.mock("../../lib/analytics", () => ({ track: mocks.track }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = null;
  mocks.conversations = [];
  mocks.loading = false;
  mocks.error = null;
});

describe("ConversationsPage — signed out", () => {
  it("shows a sign-in prompt", () => {
    render(<ConversationsPage />);
    expect(screen.getByText("Sign in to view your conversations")).toBeInTheDocument();
    expect(screen.getByTestId("signin-buttons")).toBeInTheDocument();
  });
});

describe("ConversationsPage — signed in", () => {
  it("shows a loading state", () => {
    mocks.user = { id: "u1" };
    mocks.loading = true;
    render(<ConversationsPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an error state", () => {
    mocks.user = { id: "u1" };
    mocks.error = "boom";
    render(<ConversationsPage />);
    expect(screen.getByText("Failed to load conversations: boom")).toBeInTheDocument();
  });

  it("shows an empty state when there are no conversations", () => {
    mocks.user = { id: "u1" };
    render(<ConversationsPage />);
    expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
  });

  it("renders a ConversationCard per conversation and wires row click → openChat + track", () => {
    mocks.user = { id: "u1" };
    mocks.conversations = [
      { id: "c1", title: "Mine", updatedAt: "2026-01-01T00:00:00.000Z", messageCount: 3 },
    ];
    render(<ConversationsPage />);
    expect(screen.getByText("Mine")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mine"));
    expect(mocks.openChat).toHaveBeenCalledWith("c1", "Mine");
    expect(mocks.track).toHaveBeenCalledWith("chat_conversation_open", { id: "c1", message_count: 3 });
  });

  it("Delete: confirms, then calls remove + track", async () => {
    mocks.user = { id: "u1" };
    mocks.conversations = [
      { id: "c1", title: "Mine", updatedAt: "2026-01-01T00:00:00.000Z", messageCount: 3 },
    ];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConversationsPage />);
    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("c1"));
    expect(mocks.track).toHaveBeenCalledWith("chat_conversation_delete", { id: "c1" });
    // Signals the widget so it can drop the thread if this is the open one.
    expect(mocks.notifyDeleted).toHaveBeenCalledWith("c1");
  });

  it("Delete: cancelling the confirm dialog skips remove", () => {
    mocks.user = { id: "u1" };
    mocks.conversations = [
      { id: "c1", title: "Mine", updatedAt: "2026-01-01T00:00:00.000Z", messageCount: 3 },
    ];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConversationsPage />);
    fireEvent.click(screen.getByText("Delete"));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("Rename: wires through to the rename() hook function and tracks it", async () => {
    mocks.user = { id: "u1" };
    mocks.conversations = [
      { id: "c1", title: "Mine", updatedAt: "2026-01-01T00:00:00.000Z", messageCount: 3 },
    ];
    render(<ConversationsPage />);
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("Mine");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(mocks.rename).toHaveBeenCalledWith("c1", "Renamed");
    await waitFor(() => expect(mocks.track).toHaveBeenCalledWith("chat_conversation_rename", { id: "c1" }));
  });
});
