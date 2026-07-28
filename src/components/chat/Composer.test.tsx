// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Composer } from "./Composer";

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof Composer>> = {}) {
  const onDraftChange = vi.fn();
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onRecheckUsage = vi.fn();
  const props = {
    draft: "",
    onDraftChange,
    onSend,
    onStop,
    streaming: false,
    rateLimit: null,
    onRecheckUsage,
    error: null,
    placeholder: "Ask…",
    chip: "atlas",
    usage: null,
    commons: null,
    ...over,
  };
  const utils = render(<Composer {...props} />);
  return { ...utils, onDraftChange, onSend, onStop, onRecheckUsage };
}

describe("Composer", () => {
  it("renders the placeholder and context chip", () => {
    setup({ placeholder: "Ask about X…", chip: "atlas · A.1.1" });
    expect(screen.getByPlaceholderText("Ask about X…")).toBeInTheDocument();
    expect(screen.getByText("atlas · A.1.1")).toBeInTheDocument();
  });

  it("propagates textarea input to onDraftChange", () => {
    const { onDraftChange } = setup();
    fireEvent.change(screen.getByPlaceholderText("Ask…"), { target: { value: "hello" } });
    expect(onDraftChange).toHaveBeenCalledWith("hello");
  });

  it("disables the send button when the draft is empty", () => {
    setup({ draft: "" });
    expect(screen.getByLabelText("Send")).toBeDisabled();
  });

  it("enables send with a non-empty draft and calls onSend on click", () => {
    const { onSend } = setup({ draft: "hi" });
    const btn = screen.getByLabelText("Send");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalled();
  });

  it("disables the send button and textarea when rate-limited", () => {
    setup({ draft: "hi", rateLimit: { message: "slow down", kind: "token" } });
    expect(screen.getByLabelText("Send")).toBeDisabled();
    expect(screen.getByPlaceholderText("Ask…")).toBeDisabled();
    expect(screen.getByText("locked")).toBeInTheDocument();
  });

  it("does not send on Enter while rate-limited", () => {
    const { onSend } = setup({ draft: "hi", rateLimit: { message: "slow down", kind: "token" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the token-window lock note with a countdown and no recheck button", () => {
    setup({ rateLimit: { message: "Usage limit reached.", resetsAt: new Date(Date.now() + 5 * 60_000).toISOString(), kind: "token" } });
    expect(screen.getByText("Usage limit reached.")).toBeInTheDocument();
    expect(screen.getByText(/You can send again in/)).toBeInTheDocument();
    expect(screen.queryByText("Check now")).toBeNull();
  });

  it("shows the commons lock note with a recheck button that calls onRecheckUsage", () => {
    const { onRecheckUsage } = setup({ rateLimit: { message: "Shared pool is out of credits.", kind: "commons" } });
    expect(screen.getByText("Shared pool is out of credits.")).toBeInTheDocument();
    const btn = screen.getByText("Check now");
    fireEvent.click(btn);
    expect(onRecheckUsage).toHaveBeenCalled();
  });

  it("shows the error note (not the lock note) when a turn failed and no lock is active", () => {
    setup({ error: "the model errored" });
    expect(screen.getByText(/the model errored/)).toBeInTheDocument();
  });

  it("suppresses the error note while a rate-limit lock is active", () => {
    setup({ error: "the model errored", rateLimit: { message: "slow down", kind: "token" } });
    expect(screen.queryByText(/the model errored/)).toBeNull();
  });

  it("sends on Enter (without shift) when not streaming/disabled and has a trimmed draft", () => {
    const { onSend } = setup({ draft: "hi" });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalled();
  });

  it("does not send on Enter when the draft is only whitespace", () => {
    const { onSend } = setup({ draft: "   " });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send on Shift+Enter (newline instead)", () => {
    const { onSend } = setup({ draft: "hi" });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send on Enter while streaming", () => {
    const { onSend } = setup({ draft: "hi", streaming: true });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a stop button while streaming and calls onStop", () => {
    const { onStop } = setup({ streaming: true });
    expect(screen.getByText("streaming…")).toBeInTheDocument();
    const stopBtn = screen.getByLabelText("Stop");
    fireEvent.click(stopBtn);
    expect(onStop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Send")).toBeNull();
  });

  it("shows the send hint when idle", () => {
    setup({ streaming: false });
    expect(screen.getByText("↵ to send")).toBeInTheDocument();
  });

  it("renders UsageNote and CommonsNote when data is present", () => {
    setup({
      usage: { tokens: 10, limit: 100, resetsAt: new Date(Date.now() + 60000).toISOString(), exceeded: false, windowMinutes: 60 },
      commons: { used: 1, total: 10, remaining: 9 },
    });
    expect(screen.getByText(/used 10% of your token window/)).toBeInTheDocument();
    expect(screen.getByText(/left of \$10.00/)).toBeInTheDocument();
  });
});
