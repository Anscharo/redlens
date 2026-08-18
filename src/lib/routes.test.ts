// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  absolutizeAtlasLinks,
  atlasHref,
  atlasUrl,
  ROUTES,
  REPORT_TITLES,
  activeNavPageFor,
  usesWindowScroll,
} from "./routes";

describe("atlasUrl", () => {
  it("builds an absolute link off window.location.origin in a browser context", () => {
    expect(atlasUrl("abc-123")).toBe(`${window.location.origin}${atlasHref("abc-123")}`);
    expect(atlasUrl("abc-123")).toMatch(/^https?:\/\/.+\/atlas\?id=abc-123$/);
  });
});

describe("absolutizeAtlasLinks", () => {
  it("rewrites in-app /atlas/<id> citation links to absolute /atlas?id=<id> URLs", () => {
    const md = "See [Scope A](/atlas/11111111-2222-3333-4444-555555555555) and [B](/atlas/abc).";
    const out = absolutizeAtlasLinks(md);
    expect(out).toBe(
      `See [Scope A](${window.location.origin}/atlas?id=11111111-2222-3333-4444-555555555555) and [B](${window.location.origin}/atlas?id=abc).`,
    );
  });

  it("leaves non-atlas links and plain text untouched", () => {
    const md = "A [real link](https://example.com/x) and text with /atlas/ inline.";
    expect(absolutizeAtlasLinks(md)).toBe(md);
  });
});

describe("CrossView route registration", () => {
  it("nests the three crossview sub-tab routes under REPORTS_CROSSVIEW", () => {
    expect(ROUTES.REPORTS_CROSSVIEW).toBe("/reports/crossview");
    expect(ROUTES.REPORTS_CROSSVIEW_CONCEPTS).toBe(`${ROUTES.REPORTS_CROSSVIEW}/concepts`);
    expect(ROUTES.REPORTS_CROSSVIEW_AUDIT).toBe(`${ROUTES.REPORTS_CROSSVIEW}/audit`);
    expect(ROUTES.REPORTS_CROSSVIEW_GLOSSARY).toBe(`${ROUTES.REPORTS_CROSSVIEW}/glossary`);
  });

  it("registers a display title for the crossview report id, matching the /reports/<id> slug convention", () => {
    expect(REPORT_TITLES.crossview).toBe("Atlas CrossView");
    // Every other report id in REPORT_TITLES is the last path segment of a
    // ROUTES.REPORTS_* constant; crossview's slug ("crossview") is the same
    // last segment as its ROUTES.REPORTS_CROSSVIEW route.
    expect(ROUTES.REPORTS_CROSSVIEW.split("/").pop()).toBe("crossview");
  });
});

describe("activeNavPageFor", () => {
  it("prefix-matches each nav section, including sub-routes", () => {
    expect(activeNavPageFor(ROUTES.ATLAS)).toBe("atlas");
    expect(activeNavPageFor(ROUTES.CONSTELLATIONS)).toBe("constellations");
    expect(activeNavPageFor(ROUTES.RADAR_ACTOR.replace(":slug", "keel"))).toBe("radar");
    expect(activeNavPageFor(ROUTES.REPORTS_ONCHAIN_ADDRESSES)).toBe("reports");
  });

  it("returns null off-nav (home, standalone pages)", () => {
    expect(activeNavPageFor(ROUTES.HOME)).toBeNull();
    expect(activeNavPageFor(ROUTES.PRIVACY)).toBeNull();
  });
});

describe("usesWindowScroll", () => {
  it("opts reports, radar, collections, and conversations into window scroll", () => {
    expect(usesWindowScroll(ROUTES.REPORTS)).toBe(true);
    expect(usesWindowScroll(ROUTES.REPORTS_ONCHAIN_ADDRESSES)).toBe(true);
    expect(usesWindowScroll(ROUTES.RADAR)).toBe(true);
    expect(usesWindowScroll(ROUTES.COLLECTIONS)).toBe(true);
    expect(usesWindowScroll(ROUTES.CONVERSATIONS)).toBe(true);
  });

  it("leaves the fixed-shell layout for the atlas reader and home", () => {
    expect(usesWindowScroll(ROUTES.ATLAS)).toBe(false);
    expect(usesWindowScroll(ROUTES.HOME)).toBe(false);
  });
});
