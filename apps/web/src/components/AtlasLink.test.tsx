// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AtlasLink } from "./AtlasLink";
import { atlasHref } from "@/lib/routes";

afterEach(cleanup);

describe("AtlasLink", () => {
  it("carries split and subset from the current URL into the target", () => {
    window.history.replaceState(null, "", "/atlas?id=old&split=cmp&subset=changed");
    const { container } = render(<AtlasLink to={atlasHref("new-id")}>go</AtlasLink>);
    const href = container.querySelector("a")!.getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("id")).toBe("new-id");
    expect(params.get("split")).toBe("cmp");
    expect(params.get("subset")).toBe("changed");
  });

  it("does not add split/subset when the destination already sets them", () => {
    window.history.replaceState(null, "", "/atlas?id=old&split=cmp&subset=changed");
    const { container } = render(
      <AtlasLink to={`${atlasHref("new-id")}&subset=selected`}>go</AtlasLink>,
    );
    const href = container.querySelector("a")!.getAttribute("href")!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("subset")).toBe("selected");
  });

  it("is a no-op when the current URL has neither split nor subset", () => {
    window.history.replaceState(null, "", "/atlas?id=old");
    const { container } = render(<AtlasLink to={atlasHref("new-id")}>go</AtlasLink>);
    const href = container.querySelector("a")!.getAttribute("href")!;
    expect(href).toBe(atlasHref("new-id"));
  });

  it("leaves non-atlas destinations untouched", () => {
    window.history.replaceState(null, "", "/atlas?id=old&split=cmp&subset=changed");
    const { container } = render(<AtlasLink to="/collections">go</AtlasLink>);
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/collections");
  });
});
