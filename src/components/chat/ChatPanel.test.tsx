// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PageContextView } from "./pageContext";
import type { ChatMsg, SendResult } from "./useChatStream";
import type { ChatSession } from "./useChatSession";
import type { RateLimitState } from "./types";

vi.mock("@/lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));
// ChatEmptyState's "Continue a previous chat" fetch — additive-only and not
// this file's concern; keep it a resolved empty list so it never renders.
vi.mock("@/lib/conversationsApi", () => ({ listConversations: vi.fn(async () => []) }));

const { track, refresh, send, stop, setRateLimit, newChat, openConversation, openAuth, setPref } = vi.hoisted(() => ({
  track: vi.fn(),
  refresh: vi.fn(),
  send: vi.fn(async (): Promise<SendResult> => ({})),
  stop: vi.fn(),
  setRateLimit: vi.fn(),
  newChat: vi.fn(),
  openConversation: vi.fn(),
  openAuth: vi.fn(),
  setPref: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ track }));
// SignInButtons (rendered in the signed-out composer) gates on authProviders();
// under vitest the real one returns [] (usersEnabled() is false), so stub it.
vi.mock("@/lib/authProviders", () => ({ authProviders: () => ["github", "google"] }));
// SignInButtons also calls useAuth() itself (for openAuth) — ChatPanel no
// longer calls it directly (that's session.authed/openAuth now), but this
// sibling component still does.
vi.mock("./auth", () => ({ useAuth: () => ({ openAuth: vi.fn() }) }));

let prefsState: { traces: boolean; reduceMotion: boolean; delivery: "staged" | "streaming" | null } = { traces: false, reduceMotion: false, delivery: null };
vi.mock("./usePrefs", () => ({ usePrefs: () => ({ prefs: prefsState, setPref }) }));

import { ChatPanel } from "./ChatPanel";

const baseContext: PageContextView = {
  short: "Ask the Sky Atlas",
  placeholder: "Ask about the Sky Atlas…",
  label: "Sky Atlas",
  chip: "atlas",
};

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    authed: true,
    openAuth,
    messages: [],
    streaming: false,
    error: null,
    send,
    stop,
    conversationId: null,
    contextTokens: null,
    usage: null,
    commons: null,
    contextWindow: null,
    refresh,
    rateLimit: null,
    setRateLimit,
    title: null,
    loadingHistory: false,
    newChat,
    openConversation,
    ...overrides,
  };
}

function renderPanel(
  over: { session?: Partial<ChatSession>; context?: PageContextView; placement?: "float" | "anchored" } = {},
) {
  const onClose = vi.fn();
  const onAtlas = vi.fn();
  const onTogglePlacement = vi.fn();
  const props = {
    session: makeSession(over.session),
    onClose,
    context: over.context ?? baseContext,
    onAtlas,
    placement: over.placement ?? ("float" as const),
    onTogglePlacement,
  };
  const utils = render(<ChatPanel {...props} />);
  return { ...utils, onClose, onAtlas, onTogglePlacement };
}

// A session whose `rateLimit` field is real React state, mirroring what
// useChatSession really hands ChatPanel — needed for the one test that
// checks ChatPanel reacts to setRateLimit rather than just calling it.
function ReactiveRateLimitPanel() {
  const [rateLimit, setLocalRateLimit] = useState<RateLimitState | null>(null);
  const session = makeSession({
    rateLimit,
    setRateLimit: (rl) => setLocalRateLimit(typeof rl === "function" ? rl(rateLimit) : rl),
  });
  return (
    <ChatPanel
      session={session}
      onClose={vi.fn()}
      context={baseContext}
      onAtlas={vi.fn()}
      placement="float"
      onTogglePlacement={vi.fn()}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  prefsState = { traces: false, reduceMotion: false, delivery: null };
  // jsdom doesn't implement Element.scrollTo
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("ChatPanel signed out", () => {
  it("shows the sign-in prompt and locked starters instead of the composer", () => {
    renderPanel({ session: { authed: false } });
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
    renderPanel({ context: { ...baseContext, reportName: "Rewards", reportTool: "atlas_report_rewards" } });
    expect(screen.getByText("Viewing the Rewards report")).toBeInTheDocument();
    expect(screen.getByText("Summarize the Rewards report.")).toBeInTheDocument();
  });

  it("sends a starter click: tracks, sends trimmed text with full page context", () => {
    renderPanel({ context: { ...baseContext, path: "/atlas", nodeId: "n1", nodeTitle: "T", nodeDocNo: "A.1" } });
    const starter = screen.getByText("Trace the governance path for an Atlas amendment.");
    fireEvent.click(starter);
    expect(track).toHaveBeenCalledWith("chat_starter_click", { product: "chat", starter: 2 });
    expect(track).toHaveBeenCalledWith("chat_message_sent", { product: "chat", node_id: "n1", path: "/atlas" });
    expect(send).toHaveBeenCalledWith(
      "Trace the governance path for an Atlas amendment.",
      expect.objectContaining({ path: "/atlas", nodeId: "n1", nodeTitle: "T", nodeDocNo: "A.1" }),
      undefined,
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
    expect(send).toHaveBeenCalledWith("my question", expect.any(Object), undefined);
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toHaveValue(""));
    expect(localStorage.getItem("rlc-draft")).toBe("");
  });

  it("ignores a whitespace-only send attempt", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "   " } });
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });
});

describe("ChatPanel loading a restored conversation", () => {
  it("shows a loading note instead of starters while a conversation is being fetched", () => {
    renderPanel({ session: { loadingHistory: true } });
    expect(screen.getByText("Loading conversation…")).toBeInTheDocument();
    expect(screen.queryByText("Ask the Atlas")).toBeNull();
  });

  // Regression: the composer used to stay live during this window, so a quick
  // send before hydrate() landed was posted to the previous conversation.
  it("disables the composer while a conversation is being fetched", () => {
    renderPanel({ session: { loadingHistory: true } });
    expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled();
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });
});

describe("ChatPanel rate limiting", () => {
  it("disables the composer when session.rateLimit is set", () => {
    renderPanel({ session: { rateLimit: { message: "slow down", kind: "token" } } });
    expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled();
    expect(screen.getByText("slow down")).toBeInTheDocument();
  });

  it("normalizes a rate-limited send() result into session.setRateLimit, defaulting kind from resetsAt", async () => {
    // The real send() always sets `kind` (see the comment in ChatPanel.doSend) —
    // this exercises the defensive fallback for a caller that doesn't, which
    // only a loosened (non-`RateLimitState`) mock can express.
    send.mockResolvedValueOnce({
      rateLimited: { message: "slow down", resetsAt: "2099-01-01T00:00:00Z" },
    } as unknown as SendResult);
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(setRateLimit).toHaveBeenCalledWith({ message: "slow down", resetsAt: "2099-01-01T00:00:00Z", kind: "token" }));
  });

  it("clears the lock (setRateLimit(null)) on a normal, non-rate-limited send", async () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(setRateLimit).toHaveBeenCalledWith(null));
  });

  it("reacts to setRateLimit: the composer disables the instant the panel's own session state updates", async () => {
    send.mockResolvedValueOnce({ rateLimited: { message: "Shared pool is out of credits.", kind: "commons" } });
    render(<ReactiveRateLimitPanel />);
    fireEvent.change(screen.getByPlaceholderText("Ask about the Sky Atlas…"), { target: { value: "q1" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(screen.getByPlaceholderText("Ask about the Sky Atlas…")).toBeDisabled());
    expect(screen.getByText("Shared pool is out of credits.")).toBeInTheDocument();
  });
});

describe("ChatPanel context-size indicator", () => {
  it("does not render the left-edge context line when context is unknown", () => {
    renderPanel({ session: { contextTokens: null, contextWindow: 128000 } });
    expect(document.querySelector(".rlc-ctxline")).toBeNull();
  });

  it("renders the left-edge context line sized to the context percent when known", () => {
    renderPanel({ session: { contextTokens: 12800, contextWindow: 128000 } });
    const fill = document.querySelector(".rlc-ctxline-fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.height).toBe("10%");
  });

  it("passes contextTokens/contextWindow through to the composer's LimitsMeter", () => {
    renderPanel({ session: { contextTokens: 12800, contextWindow: 128000 } });
    expect(screen.getByText("context window · 10% · 12.8k / 128k")).toBeInTheDocument();
  });
});

describe("ChatPanel stream errors", () => {
  it("does not show an error note when there is no error", () => {
    renderPanel();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces a failed-turn error visibly above the composer", () => {
    renderPanel({ session: { error: "the model errored" } });
    expect(screen.getByRole("alert")).toHaveTextContent("the model errored");
  });

  it("suppresses the error note while a rate-limit lock is active (the lock note owns that story)", () => {
    renderPanel({ session: { error: "the model errored", rateLimit: { message: "slow down", kind: "token" } } });
    expect(screen.queryByText("the model errored")).toBeNull();
    expect(screen.getByText("slow down")).toBeInTheDocument();
  });
});

describe("ChatPanel with messages", () => {
  const msgs: ChatMsg[] = [
    { role: "user", content: "hello", trace: [], rounds: 0, sources: [], done: true },
    { role: "assistant", content: "hi back", trace: [], rounds: 0, sources: [], done: true },
  ];

  it("renders each message via Message instead of the empty state", () => {
    renderPanel({ session: { messages: msgs } });
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hi back")).toBeInTheDocument();
    expect(screen.queryByText("Ask the Atlas")).toBeNull();
  });

  it("passes showTrace from prefs down to Message/ToolTrace", () => {
    prefsState = { traces: true, reduceMotion: false, delivery: null };
    renderPanel({
      session: {
        messages: [
          {
            role: "assistant",
            content: "answer",
            trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 5 }],
            rounds: 1,
            sources: [],
            done: true,
          },
        ],
      },
    });
    expect(screen.getByText("looked up 1 thing over the atlas")).toBeInTheDocument();
  });

  it("shows a stop control while streaming and wires it to session.stop", () => {
    renderPanel({
      session: { streaming: true, messages: [{ role: "assistant", content: "", trace: [], rounds: 0, sources: [], done: false }] },
    });
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(stop).toHaveBeenCalled();
  });
});

describe("ChatPanel header", () => {
  it("shows the conversation title, falling back to 'Atlas' when null", () => {
    renderPanel({ session: { title: "My earlier chat" } });
    expect(screen.getByText("My earlier chat")).toBeInTheDocument();
  });

  it("falls back to 'Atlas' for a fresh/untitled thread", () => {
    renderPanel({ session: { title: null } });
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls session.newChat when New chat is clicked", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("New chat"));
    expect(newChat).toHaveBeenCalled();
  });

  it("shows a dock icon while floating and pops out to anchored on toggle click", () => {
    const { onTogglePlacement } = renderPanel();
    fireEvent.click(screen.getByTitle("Dock to the side"));
    expect(onTogglePlacement).toHaveBeenCalled();
  });

  it("shows a float-out control while anchored", () => {
    renderPanel({ placement: "anchored" });
    expect(screen.getByTitle("Pop out to a floating window")).toBeInTheDocument();
  });
});

describe("ChatPanel staged-delivery toggle", () => {
  it("is unpressed by default (delivery: null) and turns on staged on click", () => {
    renderPanel();
    const toggle = screen.getByLabelText("Staged answers (show steps, reveal the final answer once)");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(setPref).toHaveBeenCalledWith("delivery", "staged");
  });

  it("shows pressed when the pref is already staged, and clicking clears it back to null", () => {
    prefsState = { traces: false, reduceMotion: false, delivery: "staged" };
    renderPanel();
    const toggle = screen.getByLabelText("Staged answers (show steps, reveal the final answer once)");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(setPref).toHaveBeenCalledWith("delivery", null);
  });

  it("threads the delivery pref into send() as the third argument", () => {
    prefsState = { traces: false, reduceMotion: false, delivery: "staged" };
    renderPanel();
    const textarea = screen.getByPlaceholderText("Ask about the Sky Atlas…");
    fireEvent.change(textarea, { target: { value: "my question" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(send).toHaveBeenCalledWith("my question", expect.any(Object), "staged");
  });
});
