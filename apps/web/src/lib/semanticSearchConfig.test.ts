// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { semanticSearchAvailable } from "./semanticSearchConfig";

afterEach(() => {
  delete window.__SEMANTIC_SEARCH__;
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
