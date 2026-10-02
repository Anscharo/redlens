import { describe, it, expect, vi } from "vitest";
import { applyMode, isMixedQuotes, runSlashCommand } from "./useSearchInput";
import { SLASH_COMMANDS } from "../lib/shortcuts";

// ---------------------------------------------------------------------------
// applyMode — broad mode is always a no-op
// ---------------------------------------------------------------------------

describe("applyMode: broad", () => {
  it("returns plain text unchanged", () => {
    expect(applyMode("governance", "broad")).toBe("governance");
  });
  it("returns field filters unchanged", () => {
    expect(applyMode("type:Core delegate", "broad")).toBe("type:Core delegate");
  });
  it("returns a query with double quotes unchanged", () => {
    expect(applyMode('"foo"', "broad")).toBe('"foo"');
  });
});

// ---------------------------------------------------------------------------
// applyMode — phrase wraps bare terms in double quotes
// ---------------------------------------------------------------------------

describe("applyMode: phrase", () => {
  it("wraps a single bare term", () => {
    expect(applyMode("governance", "phrase")).toBe('"governance"');
  });

  it("wraps multiple bare terms as one phrase", () => {
    expect(applyMode("properly implemented", "phrase")).toBe('"properly implemented"');
  });

  it("in: filter passes through; bare term is wrapped", () => {
    expect(applyMode("in:A.1.2 delegate", "phrase")).toBe('in:A.1.2 "delegate"');
  });

  it("type: filter passes through; bare term is wrapped", () => {
    expect(applyMode("type:Core delegate", "phrase")).toBe('type:Core "delegate"');
  });

  it("exclusion token passes through; bare term is wrapped", () => {
    expect(applyMode("-slippery alignment", "phrase")).toBe('-slippery "alignment"');
  });

  it("query with only field tokens returns unchanged", () => {
    expect(applyMode("type:Core", "phrase")).toBe("type:Core");
  });

  it("quoted multi-word field value is preserved; free text is wrapped", () => {
    expect(applyMode('type:"Type Specification" content', "phrase")).toBe(
      'type:"Type Specification" "content"',
    );
  });

  it("bypasses when query already contains double quotes", () => {
    expect(applyMode('"foo bar"', "phrase")).toBe('"foo bar"');
  });

  it("bypasses when query already contains single quotes", () => {
    expect(applyMode("'foo'", "phrase")).toBe("'foo'");
  });

  it("bypasses when query contains a fuzzy suffix", () => {
    expect(applyMode("foo~2", "phrase")).toBe("foo~2");
  });
});

// ---------------------------------------------------------------------------
// applyMode — strict wraps bare terms in single quotes
// ---------------------------------------------------------------------------

describe("applyMode: strict", () => {
  it("wraps a single bare term", () => {
    expect(applyMode("delegatedSigners", "strict")).toBe("'delegatedSigners'");
  });

  it("wraps multiple bare terms as one phrase", () => {
    expect(applyMode("Delegated Signers", "strict")).toBe("'Delegated Signers'");
  });

  it("type: filter passes through; bare term uses single quotes", () => {
    expect(applyMode("type:Core delegate", "strict")).toBe("type:Core 'delegate'");
  });

  it("bypasses when query already contains single quotes", () => {
    expect(applyMode("'existing'", "strict")).toBe("'existing'");
  });

  it("bypasses when query contains a fuzzy suffix", () => {
    expect(applyMode("foo~1", "strict")).toBe("foo~1");
  });
});

// ---------------------------------------------------------------------------
// isMixedQuotes — detects partial/hand-typed quote mixing
// ---------------------------------------------------------------------------

describe("isMixedQuotes", () => {
  it("returns false for plain text (no quotes)", () => {
    expect(isMixedQuotes("governance")).toBe(false);
  });

  it("returns false for a cleanly double-quoted phrase", () => {
    expect(isMixedQuotes('"properly implemented"')).toBe(false);
  });

  it("returns false for a cleanly single-quoted phrase", () => {
    expect(isMixedQuotes("'delegatedSigners'")).toBe(false);
  });

  it("returns false for field filter + clean quote wrap", () => {
    expect(isMixedQuotes('type:Core "foo bar"')).toBe(false);
  });

  it("returns true when some free terms are quoted and some are not", () => {
    expect(isMixedQuotes('"foo" bar')).toBe(true);
  });

  it("returns true when bare term precedes a quoted term", () => {
    expect(isMixedQuotes('foo "bar"')).toBe(true);
  });

  it("returns true for scope filter + mixed free text", () => {
    expect(isMixedQuotes('in:A.1.2 "foo" bar')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runSlashCommand — the `/` cheat sheet and the router must agree
// ---------------------------------------------------------------------------

describe("runSlashCommand", () => {
  // The cheat sheet (SLASH_COMMANDS) and the destinations (SLASH_TARGETS) are
  // separate lists in separate files; without this a command could be listed
  // and then do nothing when typed or clicked.
  it("resolves every command the cheat sheet advertises", () => {
    for (const { cmd } of SLASH_COMMANDS) {
      const navigate = vi.fn();
      const assign = vi.fn();
      vi.stubGlobal("window", { location: { assign } });
      expect(runSlashCommand(cmd, navigate), `${cmd} is listed but resolves nowhere`).toBe(true);
      expect(
        navigate.mock.calls.length + assign.mock.calls.length,
        `${cmd} resolved but navigated nowhere`,
      ).toBe(1);
      vi.unstubAllGlobals();
    }
  });

  it("sends SPA routes through navigate", () => {
    const navigate = vi.fn();
    expect(runSlashCommand("/features", navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/features");
  });

  // /preview has no <Route> — main.tsx resolves it from window.location before
  // the router mounts, so an SPA navigate would render nothing.
  it("sends /preview through a full page load, not navigate", () => {
    const navigate = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    expect(runSlashCommand("/preview", navigate)).toBe(true);
    expect(assign).toHaveBeenCalledWith("/preview");
    expect(navigate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("leaves a normal query alone", () => {
    const navigate = vi.fn();
    expect(runSlashCommand("delegate", navigate)).toBe(false);
    expect(runSlashCommand("/nope", navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
