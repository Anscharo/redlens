// @vitest-environment jsdom
// The app shell's search row: the broad/phrase/strict mode pills, the phone's
// mode-cycle button, the `in:` scope button and the scope chip, as ShellSearch
// composes them for each scope. Tooltip is stubbed to its child.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { ShellSearch } from "./ShellSearch";
import type { SearchInput } from "../hooks/useSearchInput";
import type { SearchScope } from "@/lib/routes";

vi.mock("./Tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

afterEach(cleanup);

interface Over {
  scope: SearchScope;
  query: string;
  mode: SearchInput["activeMode"];
  isMixed: boolean;
  lane: SearchInput["lane"];
  inScope: SearchInput["inScope"];
}

// The slice of useSearchInput's result ShellSearch reads; the rest is never touched.
function setup(over: Partial<Over> = {}) {
  const onSetMode = vi.fn();
  const search = {
    query: over.query ?? "",
    activeMode: over.mode ?? "broad",
    isMixed: over.isMixed ?? false,
    lane: over.lane ?? "lexical",
    inScope: over.inScope ?? { scopeDoc: null, scoped: null, toggleScope: vi.fn() },
    inputRef: createRef<HTMLInputElement>(),
    handleChange: vi.fn(),
    clearQuery: vi.fn(),
    wrapModeClick: onSetMode,
    recentSearches: [],
    selectRecent: vi.fn(),
  } as unknown as SearchInput;
  render(<ShellSearch search={search} scope={over.scope ?? "atlas"} onSubmit={() => false} />);
  return { onSetMode };
}

const MEANING_OFF = "Broad / phrase / strict apply to wording search — the meaning lane scores whole documents";

// The wide-screen pill showing `symbol`; the phone's cycle button (data-mode)
// shows the current mode's symbol too.
const pill = (symbol: string) => screen.getAllByText(symbol).find((b) => !b.hasAttribute("data-mode"))!;
const cycleButton = () => document.querySelector<HTMLButtonElement>("button[data-mode]")!;

describe("ShellSearch mode pills", () => {
  it("renders all three pills in atlas scope and presses the active one", () => {
    setup({ mode: "phrase" });
    const pills = screen.getAllByRole("button").filter((b) => b.classList.contains("mode-pill") && !b.hasAttribute("data-mode") && b.textContent !== "in:");
    expect(pills).toHaveLength(3);
    expect(pill('"a"')).toHaveAttribute("aria-pressed", "true");
    expect(pill("a*")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onSetMode with the clicked mode", () => {
    const { onSetMode } = setup({ mode: "broad" });
    fireEvent.click(screen.getByText("Aa"));
    expect(onSetMode).toHaveBeenCalledWith("strict");
  });

  it("disables the pills and clears the pressed state when the query is mixed", () => {
    setup({ mode: "broad", isMixed: true });
    const broad = pill("a*");
    expect(broad).toBeDisabled();
    expect(broad).toHaveAttribute("aria-pressed", "false");
  });

  it("hides the mode pills outside the atlas scope", () => {
    setup({ scope: "radar" });
    expect(screen.queryByText("a*")).toBeNull();
  });

  it("disables all three, unpressed, when a lane cannot honour them — and says why", () => {
    // Disabled rather than hidden: the reader who reaches for a pill gets the
    // reason, where a vanished control would just look like a missing feature.
    setup({ mode: "phrase", lane: "semantic" });
    for (const symbol of ["a*", '"a"', "Aa"]) {
      const p = pill(symbol);
      expect(p).toBeDisabled();
      expect(p).toHaveAttribute("aria-pressed", "false");
      expect(p).toHaveAttribute("aria-label", MEANING_OFF);
    }
    expect(cycleButton()).toBeDisabled();
    expect(cycleButton()).toHaveAttribute("aria-label", `"a" ${MEANING_OFF}`);
  });
});

describe("ShellSearch mode-cycle button (phones)", () => {
  it("shows the current mode and steps broad → phrase → strict → broad", () => {
    for (const [mode, next] of [["broad", "phrase"], ["phrase", "strict"], ["strict", "broad"]] as const) {
      const { onSetMode } = setup({ mode });
      fireEvent.click(cycleButton());
      expect(onSetMode).toHaveBeenCalledWith(next);
      cleanup();
    }
  });

  it("names the next mode in its label, without a duplicate title", () => {
    setup({ mode: "broad" });
    // Opens with the visible symbol (WCAG 2.5.3, label in name) and names the next mode.
    expect(cycleButton()).toHaveAttribute("aria-label", expect.stringMatching(/^a\* Broad .*Press for Phrase \("a"\)\.$/));
    expect(cycleButton()).not.toHaveAttribute("title");
  });

  it("is disabled when the query has mixed quotes", () => {
    setup({ mode: "broad", isMixed: true });
    expect(cycleButton()).toBeDisabled();
  });
});

describe("ShellSearch in: scope button", () => {
  const doc = { docNo: "A.1.2" };
  const scopeButton = () => screen.getByText("in:");

  it("is absent outside the atlas scope, where there is no doc_no subtree", () => {
    setup({ scope: "radar" });
    expect(screen.queryByText("in:")).toBeNull();
  });

  it("offers the open document, unpressed, and calls toggleScope", () => {
    const toggleScope = vi.fn();
    setup({ inScope: { scopeDoc: doc, scoped: null, toggleScope } });
    expect(scopeButton()).toHaveAttribute("aria-pressed", "false");
    expect(scopeButton()).toHaveAttribute("aria-label", "Search within A.1.2 and children (adds in:A.1.2)");
    fireEvent.click(scopeButton());
    expect(toggleScope).toHaveBeenCalled();
  });

  it("reads as pressed while the query is scoped", () => {
    setup({ inScope: { scopeDoc: doc, scoped: "A.1.2", toggleScope: vi.fn() } });
    expect(scopeButton()).toHaveAttribute("aria-pressed", "true");
    expect(scopeButton()).toHaveAttribute("aria-label", "Searching within A.1.2 and children — press to search the whole atlas");
  });

  it("names the replacement when scoped to a different document", () => {
    setup({ inScope: { scopeDoc: doc, scoped: "A.6", toggleScope: vi.fn() } });
    expect(scopeButton()).toHaveAttribute("aria-label", "Search within A.1.2 and children instead of A.6");
    // A press switches the scope rather than lifting it, so it does not read as pressed.
    expect(scopeButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("stays usable to lift a scope with no document open, and is disabled with neither", () => {
    setup({ inScope: { scopeDoc: null, scoped: "A.6", toggleScope: vi.fn() } });
    expect(scopeButton()).toBeEnabled();
    expect(scopeButton()).toHaveAttribute("aria-pressed", "true");
    cleanup();
    setup({ inScope: { scopeDoc: null, scoped: null, toggleScope: vi.fn() } });
    expect(scopeButton()).toBeDisabled();
    expect(scopeButton()).toHaveAttribute("aria-label", "in: open a document to search within it");
  });
});

describe("ShellSearch field", () => {
  it("shows the scope chip and labels the input for a non-atlas scope", () => {
    setup({ scope: "reports" });
    expect(screen.getByText("reports")).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-label", "Filter reports");
  });

  it("shows no chip in the atlas scope", () => {
    setup();
    expect(document.querySelector(".scope-chip")).toBeNull();
  });
});
