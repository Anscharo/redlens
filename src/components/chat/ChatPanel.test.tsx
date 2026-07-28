// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PageContextView } from "./pageContext";
import type { ChatMsg } from "./useChatStream";
import type { UsageWindow, CommonsPool } from "./api";

vi.mock("../../lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));

const { track, openAuth, refresh, send, stop } = vi.hoisted(() => ({
  track: vi.fn(),
  openAuth: vi.fn(),
  refresh: vi.fn(),
  send: vi.fn(async () => ({}) as { rateLimited?: { message: string; resetsAt?: string; kind?: "token" | "commons" } }),
  stop: vi.fn(),
}));
vi.mock("../../lib/analytics", () => ({ track }));
// SignInButtons (rendered in the signed-out composer) gates on authProviders();
// under vitest the real one returns [] (usersEnabled() is false), so stub it.
vi.mock("../../lib/authProviders", () => ({ authProviders: () => ["github", "google"] }));

let authUser: { name: string | null; avatarUrl: string } | null = { name: "Ada", avatarUrl: "a.png" };
vi.mock("./auth", () => ({ useAuth: () => ({ user: authUser, openAuth }) }));

let prefsState = { traces: false, reduceMotion: false };
vi.mock("./usePrefs", () => ({ usePrefs: () => ({ prefs: prefsState, setPref: vi.fn() }) }));

// Annotated so a test can swap in a populated pool/window — the inferred type
// from the initial value would be `{ usage: null; commons: null }`.
let usageState: { usage: UsageWindow | null; commons: CommonsPool | null } = { usage: null, commons: null };
vi.mock("./useUsage", () => ({ useUsage: () => ({ ...usageState, refresh }) }));

let chatMessages: ChatMsg[] = [];
let chatStreaming = false;
let chatError: string | null = null;
vi.mock("./useChatStream", () => ({
  useChatStream: () => ({ messages: chatMessages, streaming: chatStreaming, error: chatError, send, stop }),
}));

import { ChatPanel } from "./ChatPanel";

const baseContext: PageContextView = {
  short: "Ask the Sky Atlas",
  placeholder: "Ask about the Sky Atlas…",
  label: "Sky Atlas",
  chip: "atlas",
};

function renderPanel(over: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  const onClose = vi.fn();
  const onAtlas = vi.fn();
  const onTogglePlacement = vi.fn();
  const props = {
    onClose,
    context: baseContext,
    onAtlas,
    placement: "float" as const,
    onTogglePlacement,
    ...over,
  };
  const utils = render(<ChatPanel {...props} />);
  return { ...utils, onClose, onAtlas, onTogglePlacement };
}

beforeEach(() => {
  localStorage.clear();
  authUser = { name: "Ada", avatarUrl: "a.png" };
  chatMessages = [];
  chatStreaming = false;
  chatError = null;
  usageState = { usage: null, commons: null };
  prefsState = { traces: false, reduceMotion: false };
  // jsdom doesn't implement Element.scrollTo
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ChatPanel signed out", () => {
  it("shows the sign-in prompt and locked starters instead of the composer", () => {
    authUser = null;
    renderPanel();
    expect(screen.getByText("Sign in to ask the Atlas")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Prime Agent/ })[0]).toBeDisabled();
    expect(screen.getByText(/sign in with github to ask/)).toBeInTheDocument();
  });
});

describe("ChatPanel signed in, empty thread", () => {
  it("shows the generic empty state and starters on a non-report page", () => {
    renderPanel();
    expect(screen.getByText("Ask the Atlas")).toBeInTheDocument();
    expect(screen.getByText(/A research agent over the Sky Atlas/)).toBeInTheDocument();
  });

  it("shows report-flavored copy and starters when the context is a report page", () => {
    renderPanel({
      context: { ...baseContext, reportName: "Rewards", reportTool: "atlas_report_rewards" },
    });
    expect(screen.getByText("Viewing the Rewards report")).toBeInTheDocument();
    expect(screen.getByText("Summarize the Rewards report.")).toBeInTheDocument();
  });

  it("sends a starter click: tracks, sends trimmed text with full page context", () => {
    renderPanel({
      context: { ...baseContext, path: "/atlas", nodeId: "n1", nodeTitle: "T", nodeDocNo: "A.1" },
    });
    const starter = screen.getByText("Trace the governance path for an Atlas amendment.");
    fireEvent.click(starter);
    expect(track).toHaveBeenCalledWith("chat_starter_click", { product: "chat", starter: 2 });
    expect(track).toHaveBeenCalledWith("chat_message_sent", { product: "chat", node_id: "n1", path: "/atlas" });
    expect(send).toHaveBeenCalledWith(
      "Trace the governance path for an Atlas amendment.",
      expect.objectContaining({ path: "/atlas", nodeId: "n1", nodeTitle: "T", nodeDocNo: "A.1" }),
    );
  });

  it("restores a persisted draft from localStorage on mount and shows it in the composer", () => {
    localStorage.setItem("rlc-draft", "leftover draft");
    renderPanel();
    expect(screen.getByDisplayValue("leftover draft")).toBeInTheDocument();
  });

  it("persists composer typing to localStorage", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "hi there" } });
    expect(localStorage.getItem("rlc-draft")).toBe("hi there");
  });

  it("sends the composer draft on submit, clearing the draft", async () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText("Ask about the Sky Atlas…");
    fireEvent.change(textarea, { target: { value: "my question" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(send).toHaveBeenCalledWith("my question", expect.any(Object));
    // doSend clears the draft synchronously (setDraft("") + removeItem); the
    // draft-mirroring effect then re-persists the now-empty draft on the next
    // render, so the stored key ends up "" rather than absent.
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toHaveValue(""));
    expect(localStorage.getItem("rlc-draft")).toBe("");
  });

  it("ignores a whitespace-only send attempt", () => {
    renderPanel();
    // doSend guards on trimmed text; simulate directly via starter with blank isn't
    // possible from UI (send button already disabled), so this exercises the guard
    // through Composer's own disabled state instead.
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "   " } });
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });
});

describe("ChatPanel rate limiting", () => {
  it("marks the composer disabled after a rate-limited send result", async () => {
    send.mockResolvedValueOnce({ rateLimited: { message: "slow down" } });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled());
  });

  it("auto-lifts the lock once the token-window resetsAt passes — never permanently stuck", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    send.mockResolvedValueOnce({
      rateLimited: { message: "Usage limit reached.", resetsAt: "2026-01-01T00:00:20Z", kind: "token" },
    });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await act(async () => {}); // flush the resolved send() promise
    expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled();
    expect(screen.getByText("Usage limit reached.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).not.toBeDisabled();
    // The stale 429 text must not resurface as an error banner once unlocked
    // (useChatStream deliberately never sets `error` for a 429 — see its
    // tests — so there is nothing here for ErrorNote to pick up).
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a commons-pool lock disabled on time alone; 'Check now' rechecks /api/usage, not /api/chat", async () => {
    send.mockResolvedValueOnce({
      rateLimited: { message: "Shared pool is out of credits.", kind: "commons" },
    });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled());
    expect(screen.getByText("Shared pool is out of credits.")).toBeInTheDocument();

    // "Check now" hits /api/usage (refresh), never /api/chat — it must not
    // just let another chat request through to get another 429.
    fireEvent.click(screen.getByText("Check now"));
    expect(refresh).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);

    // usageState (the mocked useUsage's commons) is still drained — stays locked.
    expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled();
  });

  it("lifts a commons-pool lock as soon as a re-render shows the pool topped up (e.g. after refresh() resolves)", async () => {
    send.mockResolvedValueOnce({
      rateLimited: { message: "Shared pool is out of credits.", kind: "commons" },
    });
    const onClose = vi.fn();
    const onAtlas = vi.fn();
    const onTogglePlacement = vi.fn();
    const props = { onClose, context: baseContext, onAtlas, placement: "float" as const, onTogglePlacement };
    const { rerender } = render(<ChatPanel {...props} />);
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled());

    // Simulate refresh() resolving with a topped-up pool, then a re-render
    // (React re-reads the mocked useUsage() and sees the new commons value).
    usageState = { usage: null, commons: { used: 1, total: 10, remaining: 9 } };
    rerender(<ChatPanel {...props} />);
    expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).not.toBeDisabled();
  });
});

describe("ChatPanel stream errors", () => {
  it("does not show an error note when there is no error", () => {
    renderPanel();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces a failed-turn error visibly above the composer", () => {
    chatError = "the model errored";
    renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent("the model errored");
  });

  it("suppresses the error note while a rate-limit lock is active (the lock note owns that story)", async () => {
    chatError = "the model errored";
    send.mockResolvedValueOnce({ rateLimited: { message: "slow down", kind: "token", resetsAt: "2099-01-01T00:00:00Z" } });
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled());
    expect(screen.queryByText("the model errored")).toBeNull();
    expect(screen.getByText("slow down")).toBeInTheDocument();
  });
});

describe("ChatPanel with messages", () => {
  it("renders each message via Message instead of the empty state", () => {
    chatMessages = [
      { role: "user", content: "hello", trace: [], rounds: 0, sources: [], done: true },
      { role: "assistant", content: "hi back", trace: [], rounds: 0, sources: [], done: true },
    ];
    renderPanel();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hi back")).toBeInTheDocument();
    expect(screen.queryByText("Ask the Atlas")).toBeNull();
  });

  it("passes showTrace from prefs down to Message/ToolTrace", () => {
    prefsState = { traces: true, reduceMotion: false };
    chatMessages = [
      {
        role: "assistant",
        content: "answer",
        trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 5 }],
        rounds: 1,
        sources: [],
        done: true,
      },
    ];
    renderPanel();
    expect(screen.getByText("looked up 1 thing over the atlas")).toBeInTheDocument();
  });

  it("shows a stop control while streaming", () => {
    chatStreaming = true;
    chatMessages = [{ role: "assistant", content: "", trace: [], rounds: 0, sources: [], done: false }];
    renderPanel();
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(stop).toHaveBeenCalled();
  });
});

describe("ChatPanel header controls", () => {
  it("calls onClose when the close button is clicked", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a dock icon while floating and pops out to anchored on toggle click", () => {
    const { onTogglePlacement } = renderPanel({ placement: "float" });
    fireEvent.click(screen.getByTitle("Dock to the side"));
    expect(onTogglePlacement).toHaveBeenCalled();
  });

  it("shows a float-out control while anchored", () => {
    renderPanel({ placement: "anchored" });
    expect(screen.getByTitle("Pop out to a floating window")).toBeInTheDocument();
  });
});
