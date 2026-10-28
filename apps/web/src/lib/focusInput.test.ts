// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRef } from "react";
import { focusInputAt } from "./focusInput";

// Run the frame callback synchronously, so the assertions do not race it.
function runFramesNow() {
  return vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
}

function mountInput(value: string) {
  const ref = createRef<HTMLInputElement>() as { current: HTMLInputElement | null };
  const input = document.createElement("input");
  input.value = value;
  document.body.appendChild(input);
  ref.current = input;
  return { ref, input };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("focusInputAt", () => {
  it("focuses the field with the caret at the end by default", () => {
    runFramesNow();
    const { ref, input } = mountInput("fees in:A.1.2 ");
    focusInputAt(ref);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("places the caret at the position given", () => {
    runFramesNow();
    const { ref, input } = mountInput('"delegate"');
    focusInputAt(ref, 9);
    expect(input.selectionStart).toBe(9);
    expect(input.selectionEnd).toBe(9);
  });

  it("waits for the next frame, and does nothing once the field is gone", () => {
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    const ref = { current: null };
    expect(() => focusInputAt(ref)).not.toThrow();
    expect(frame).toHaveBeenCalledTimes(1);
    const cb = frame.mock.calls[0][0];
    expect(() => cb(0)).not.toThrow();
  });
});
