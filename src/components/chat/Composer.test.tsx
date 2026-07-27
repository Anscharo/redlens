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
  const props = {
    draft: "",
    onDraftChange,
    onSend,
    onStop,
    streaming: false,
    disabled: false,
    placeholder: "Ask…",
    chip: "atlas",
    usage: null,
    commons: null,
    ...over,
  };
  const utils = render(<Composer {...props} />);
  return { ...utils, onDraftChange, onSend, onStop };
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
    setup({ draft: "hi", disabled: true });
    expect(screen.getByLabelText("Send")).toBeDisabled();
    expect(screen.getByPlaceholderText("Ask…")).toBeDisabled();
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
