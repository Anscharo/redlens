// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

afterEach(() => {
  cleanup();
});

describe("Modal", () => {
  it("renders children into document.body via portal", () => {
    const { container } = render(
      <Modal label="Test" onClose={() => {}}>
        <p>Hello there</p>
      </Modal>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).toContain("Hello there");
  });

  it("sets role=dialog, aria-modal=true, and aria-label from props", () => {
    render(
      <Modal label="My Label" onClose={() => {}}>
        <p>content</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "My Label" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("Escape calls onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal label="L" onClose={onClose}>
        <p>content</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click calls onClose; click inside the card does not", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal label="L" onClose={onClose}>
        <button>Inside</button>
      </Modal>,
    );
    await user.click(screen.getByText("Inside"));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("restores focus to the previously focused element after close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Trigger</button>
          {open && (
            <Modal label="L" onClose={() => setOpen(false)}>
              <button>Inside</button>
            </Modal>
          )}
        </div>
      );
    }
    render(<Harness />);
    const trigger = screen.getByText("Trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("focuses an element inside the card on mount", () => {
    render(
      <Modal label="L" onClose={() => {}}>
        <button>First</button>
        <button>Second</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("does not steal focus from a child that sets it via autoFocus", () => {
    render(
      <Modal label="L" onClose={() => {}}>
        <button>First</button>
        <input autoFocus placeholder="auto" />
      </Modal>,
    );
    expect(screen.getByPlaceholderText("auto")).toHaveFocus();
  });
});
