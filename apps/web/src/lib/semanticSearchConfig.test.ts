// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { semanticSearchAvailable, semanticStrategyDefault } from "./semanticSearchConfig";

afterEach(() => {
  delete window.__SEMANTIC_SEARCH__;
  delete window.__SEMANTIC_STRATEGY__;
});

describe("semanticSearchAvailable", () => {
  it("is false when nothing was injected", () => {
    // Static hosting leaves the placeholder unreplaced, so the quoted compare in
    // index.html yields a bare `false` — correct there, since there is no /api.
    expect(semanticSearchAvailable()).toBe(false);
  });

  it("requires a strict true, not a truthy placeholder string", () => {
    (window as { __SEMANTIC_SEARCH__?: unknown }).__SEMANTIC_SEARCH__ = "{{SEMANTIC_SEARCH}}";
    expect(semanticSearchAvailable()).toBe(false);
    window.__SEMANTIC_SEARCH__ = true;
    expect(semanticSearchAvailable()).toBe(true);
  });
});

describe("semanticStrategyDefault", () => {
  it("is off whenever the lane cannot be answered, whatever the strategy says", () => {
    window.__SEMANTIC_STRATEGY__ = "woven";
    expect(semanticStrategyDefault()).toBe("off");
  });

  it("uses the injected strategy when the lane is available", () => {
    window.__SEMANTIC_SEARCH__ = true;
    window.__SEMANTIC_STRATEGY__ = "woven";
    expect(semanticStrategyDefault()).toBe("woven");
    window.__SEMANTIC_STRATEGY__ = "off";
    expect(semanticStrategyDefault()).toBe("off");
  });

  it("falls back to the documented default for a missing or bogus value", () => {
    window.__SEMANTIC_SEARCH__ = true;
    expect(semanticStrategyDefault()).toBe("fallback");
    window.__SEMANTIC_STRATEGY__ = "{{SEMANTIC_STRATEGY}}";
    expect(semanticStrategyDefault()).toBe("fallback");
    window.__SEMANTIC_STRATEGY__ = "hybrid";
    expect(semanticStrategyDefault()).toBe("fallback");
  });
});
