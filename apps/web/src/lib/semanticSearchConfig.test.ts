// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { semanticLaneUsable, semanticSearchAvailable } from "./semanticSearchConfig";
import { liveAtlasBase } from "./atlasBase";

afterEach(() => {
  delete window.__SEMANTIC_SEARCH__;
  delete window.__ATLAS_SHA__;
});

const SHA = "a".repeat(40);

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

describe("semanticLaneUsable", () => {
  it("is false on a preview base even where the deployment can answer", () => {
    // The route has no per-preview form: its ids come from the live pgvector
    // index, and the worker would hydrate them against the preview's own
    // docs.json. Two atlases — the ids are dropped, or they name a different
    // document. So the lane is not offered there at all.
    window.__SEMANTIC_SEARCH__ = true;
    window.__ATLAS_SHA__ = SHA;
    expect(semanticLaneUsable(`/api/preview/${"b".repeat(40)}/`)).toBe(false);
    expect(semanticLaneUsable(liveAtlasBase())).toBe(true);
  });

  it("stays false on the live base when the deployment cannot answer", () => {
    window.__ATLAS_SHA__ = SHA;
    expect(semanticLaneUsable(liveAtlasBase())).toBe(false);
  });
});
