// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { atlasHref, atlasUrl, ROUTES, REPORT_TITLES } from "./routes";

describe("atlasUrl", () => {
  it("builds an absolute link off window.location.origin in a browser context", () => {
    expect(atlasUrl("abc-123")).toBe(`${window.location.origin}${atlasHref("abc-123")}`);
    expect(atlasUrl("abc-123")).toMatch(/^https?:\/\/.+\/atlas\?id=abc-123$/);
  });
});

describe("Library route registration", () => {
  it("nests the three library sub-tab routes under REPORTS_LIBRARY", () => {
    expect(ROUTES.REPORTS_LIBRARY).toBe("/reports/library");
    expect(ROUTES.REPORTS_LIBRARY_CONCEPTS).toBe(`${ROUTES.REPORTS_LIBRARY}/concepts`);
    expect(ROUTES.REPORTS_LIBRARY_AUDIT).toBe(`${ROUTES.REPORTS_LIBRARY}/audit`);
    expect(ROUTES.REPORTS_LIBRARY_GLOSSARY).toBe(`${ROUTES.REPORTS_LIBRARY}/glossary`);
  });

  it("registers a display title for the library report id, matching the /reports/<id> slug convention", () => {
    expect(REPORT_TITLES.library).toBe("Atlas Library");
    // Every other report id in REPORT_TITLES is the last path segment of a
    // ROUTES.REPORTS_* constant; library's slug ("library") is the same
    // last segment as its ROUTES.REPORTS_LIBRARY route.
    expect(ROUTES.REPORTS_LIBRARY.split("/").pop()).toBe("library");
  });
});
