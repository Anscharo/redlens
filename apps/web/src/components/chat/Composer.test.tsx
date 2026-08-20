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
    placeholder: "Ask…",
    chip: "atlas",
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

  // Which note appears (429 lock vs failed-turn error, and the lock winning)
  // is ChatPanel's policy now — it composes the `notice` slot; ChatPanel.test
  // covers it against the real session. Composer only knows `locked`.
  it("disables the send button and textarea when locked", () => {
    setup({ draft: "hi", locked: true });
    expect(screen.getByLabelText("Send")).toBeDisabled();
    expect(screen.getByPlaceholderText("Ask…")).toBeDisabled();
    expect(screen.getByText("locked")).toBeInTheDocument();
  });

  it("does not send on Enter while locked", () => {
    const { onSend } = setup({ draft: "hi", locked: true });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders the notice slot above the input", () => {
    setup({ notice: <p data-testid="notice-slot">any note</p> });
    expect(screen.getByTestId("notice-slot")).toBeInTheDocument();
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

  // Regression: a conversation switch keeps the composer live during
  // useChatSession's openConversation() GET, so a quick send before hydrate()
  // lands used to post to the wrong (previous) conversation.
  it("disables the send button and textarea while a conversation is loading", () => {
    setup({ draft: "hi", historyLoading: true });
    expect(screen.getByLabelText("Send")).toBeDisabled();
    expect(screen.getByPlaceholderText("Ask…")).toBeDisabled();
    expect(screen.getByText("loading…")).toBeInTheDocument();
  });

  it("does not send on Enter while a conversation is loading", () => {
    const { onSend } = setup({ draft: "hi", historyLoading: true });
    fireEvent.keyDown(screen.getByPlaceholderText("Ask…"), { key: "Enter", shiftKey: false });
    expect(onSend).not.toHaveBeenCalled();
  });

});

// The limits meter reaches the composer by COMPOSITION — ChatPanel builds
// <LimitsMeter …/> and passes it as children, so the composer never sees the
// meter's data. Meter behavior is covered in LimitsMeter.test.tsx; ChatPanel's
// test covers the real wiring. This only proves the footer slot renders.
describe("Composer footer slot", () => {
  it("renders its children below the input", () => {
    setup({ children: <div data-testid="footer-slot">meter goes here</div> });
    expect(screen.getByTestId("footer-slot")).toBeInTheDocument();
  });

  it("renders nothing extra when no children are passed", () => {
    setup();
    expect(screen.queryByTestId("footer-slot")).toBeNull();
  });
});
