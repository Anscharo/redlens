// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { atlasHref, atlasUrl, ROUTES, REPORT_TITLES } from "./routes";

describe("atlasUrl", () => {
  it("builds an absolute link off window.location.origin in a browser context", () => {
    expect(atlasUrl("abc-123")).toBe(`${window.location.origin}${atlasHref("abc-123")}`);
    expect(atlasUrl("abc-123")).toMatch(/^https?:\/\/.+\/atlas\?id=abc-123$/);
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
