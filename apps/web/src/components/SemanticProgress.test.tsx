// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SemanticProgress, SEMANTIC_PROGRESS_MS } from "./SemanticProgress";

// From the vitest root, not import.meta.url: under the jsdom pragma above that
// is an http: URL, which fileURLToPath rejects. The theme tests get to use it
// only because they run in the node environment.
const CSS_PATH = path.resolve(process.cwd(), "apps/web/src/index.css");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Advance past the appear delay and into stage `n` (0-based). */
function toStage(n: number) {
  act(() => void vi.advanceTimersByTime(150 + n * 2000));
}

describe("SemanticProgress", () => {
  it("shows nothing for the first moment, so an instantly-cached lane never flashes a bar", () => {
    const { container } = render(<SemanticProgress />);
    expect(container.firstChild).toBeNull();
    act(() => void vi.advanceTimersByTime(140));
    expect(container.firstChild).toBeNull();
  });

  it("names each stage in turn, two seconds apart", () => {
    render(<SemanticProgress />);
    toStage(0);
    expect(screen.getByText("Computing multidimensional vectors")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Finding best matches")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Comparing Results")).toBeTruthy();
  });

  it("keeps saying the last stage rather than looping back to the first", () => {
    // A restarted bar would read as a restarted search. The search is still the
    // same one; it has only outrun the animation.
    render(<SemanticProgress />);
    toStage(0);
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByText("Comparing Results")).toBeTruthy();
    expect(screen.queryByText("Computing multidimensional vectors")).toBeNull();
  });

  it("leaves the bar out of the accessibility tree and makes the label the live region", () => {
    // There is no measured progress to report, so role=progressbar + aria-valuenow
    // would be asserting a number that does not exist. The stages are the signal.
    const { container } = render(<SemanticProgress />);
    toStage(0);
    expect(container.querySelector(".semantic-progress-track")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status").textContent).toBe("Computing multidimensional vectors");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("names no colour of its own — the bar is tokens, like every other surface", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    const block = css.slice(css.indexOf(".semantic-progress-track"));
    expect(block).toMatch(/background:\s*var\(--border\)/);
    expect(block).toMatch(/background:\s*var\(--accent\)/);
  });

  it("animates the fill for exactly the time the stages take to run out", () => {
    // Two declarations of one duration: the keyframe in CSS and the stage timing
    // in TS. If they drift, the bar fills early and then sits full while the
    // labels are still advancing.
    const css = readFileSync(CSS_PATH, "utf8");
    const ms = /animation:\s*semantic-progress-fill\s+(\d+)ms/.exec(css)?.[1];
    expect(Number(ms)).toBe(SEMANTIC_PROGRESS_MS);
    expect(SEMANTIC_PROGRESS_MS).toBe(6000);
  });

  it("drops the bar under reduced motion, keeping the label", () => {
    // A static track reads as a stalled search; a static full one as a finished
    // search. Neither is true, so the motion-free fallback is no bar at all.
    const css = readFileSync(CSS_PATH, "utf8");
    const reduced = css.slice(css.lastIndexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(/\.semantic-progress-track\s*\{\s*display:\s*none/);
  });
});
