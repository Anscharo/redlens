// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { atlasHref, atlasUrl, ROUTES, REPORT_TITLES } from "./routes";

describe("atlasUrl", () => {
  it("builds an absolute link off window.location.origin in a browser context", () => {
    expect(atlasUrl("abc-123")).toBe(`${window.location.origin}${atlasHref("abc-123")}`);
    expect(atlasUrl("abc-123")).toMatch(/^https?:\/\/.+\/atlas\?id=abc-123$/);
  });
});

describe("Anatomy route registration", () => {
  it("nests the three anatomy sub-tab routes under REPORTS_ANATOMY", () => {
    expect(ROUTES.REPORTS_ANATOMY).toBe("/reports/anatomy");
    expect(ROUTES.REPORTS_ANATOMY_CONCEPTS).toBe(`${ROUTES.REPORTS_ANATOMY}/concepts`);
    expect(ROUTES.REPORTS_ANATOMY_AUDIT).toBe(`${ROUTES.REPORTS_ANATOMY}/audit`);
    expect(ROUTES.REPORTS_ANATOMY_GLOSSARY).toBe(`${ROUTES.REPORTS_ANATOMY}/glossary`);
  });

  it("registers a display title for the anatomy report id, matching the /reports/<id> slug convention", () => {
    expect(REPORT_TITLES.anatomy).toBe("Atlas Anatomy");
    // Every other report id in REPORT_TITLES is the last path segment of a
    // ROUTES.REPORTS_* constant; anatomy's slug ("anatomy") is the same
    // last segment as its ROUTES.REPORTS_ANATOMY route.
    expect(ROUTES.REPORTS_ANATOMY.split("/").pop()).toBe("anatomy");
  });
});
