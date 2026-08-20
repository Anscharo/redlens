// @vitest-environment jsdom
// "copy pattern" is PalettePage's one piece of non-trivial inline logic: it
// mirrors depth-1..5 onto depth-6..17 in a repeating 6-color cycle. This is
// its own file (rather than living alongside PalettePage.test.tsx's other
// cases) because cssDefault() caches per custom-property name for the whole
// module's lifetime — the stylesheet below has to be in place *before* the
// very first render primes that cache with empty defaults.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PalettePage } from "./PalettePage";

// Appended at module load, before any test's render() call — cssDefault()
// must see these on its very first (and only, thanks to its cache) read.
const styleEl = document.createElement("style");
styleEl.textContent =
  ":root { --depth-1: #111111; --depth-2: #222222; --depth-3: #333333; --depth-4: #444444; --depth-5: #555555; }";
document.head.appendChild(styleEl);

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("PalettePage — depth 'copy pattern'", () => {
  it("mirrors depth-1..5 onto depth-6..17 in the 6-color cycle, and dirties apply", () => {
    render(<PalettePage />);
    fireEvent.click(screen.getByRole("button", { name: "copy pattern" }));

    expect(screen.getByTitle("--depth-6: #111111")).toBeInTheDocument(); // cycle position 1
    expect(screen.getByTitle("--depth-7: #222222")).toBeInTheDocument(); // cycle position 2
    expect(screen.getByTitle("--depth-10: #555555")).toBeInTheDocument(); // cycle position 5
    expect(screen.getByTitle("--depth-11: #111111")).toBeInTheDocument(); // cycle wraps back to 1
    expect(screen.getByRole("button", { name: "apply" })).toBeEnabled();
  });
});
