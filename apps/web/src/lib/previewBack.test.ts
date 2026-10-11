import { describe, it, expect } from "vitest";
import { previewBackHref } from "./previewBack";

const O = "https://redline.example";

describe("previewBackHref", () => {
  it("returns to the live atlas page the visitor came from", () => {
    expect(previewBackHref(`${O}/atlas?id=abc#x`, O, "/")).toBe("/atlas?id=abc#x");
  });

  it("returns to the PR preview the visitor came from", () => {
    expect(previewBackHref(`${O}/preview/pull-256/atlas?id=abc`, O, "/")).toBe("/preview/pull-256/atlas?id=abc");
  });

  it("falls back to the base for no referrer, another site, or the index itself", () => {
    expect(previewBackHref("", O, "/")).toBe("/");
    expect(previewBackHref("https://github.com/sky-ecosystem/next-gen-atlas/pull/1", O, "/")).toBe("/");
    expect(previewBackHref(`${O}/preview`, O, "/")).toBe("/");
    expect(previewBackHref(`${O}/preview/`, O, "/")).toBe("/");
  });

  it("never returns a protocol-relative path, which would leave the site", () => {
    expect(previewBackHref(`${O}//evil.example/x`, O, "/")).toBe("/");
  });

  it("respects a non-root base path", () => {
    expect(previewBackHref(`${O}/redlens/preview/pull-1`, O, "/redlens/")).toBe("/redlens/preview/pull-1");
    expect(previewBackHref(`${O}/redlens`, O, "/redlens/")).toBe("/redlens");
    expect(previewBackHref(`${O}/redlens/preview`, O, "/redlens/")).toBe("/redlens/");
    expect(previewBackHref(`${O}/other/page`, O, "/redlens/")).toBe("/redlens/");
  });
});
