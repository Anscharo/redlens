// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, render, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { atlasHref, atlasOnchainHref } from "@/lib/routes";

const track = vi.fn();
vi.mock("./analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { AtlasFilterProvider, hiddenTargetHref, useFilterHides } from "./atlasFilter";
import { SelectionProvider } from "./selection";
import { STORAGE_KEY } from "./selectionStore";
import { AtlasLink } from "../components/AtlasLink";
import { FilteredOutNotice } from "../components/atlas/FilteredOutNotice";
import { useNavigateToNode } from "../hooks/useNavigation";

const wrapper = ({ children }: { children: ReactNode }) => (
  <SelectionProvider>
    <AtlasFilterProvider>{children}</AtlasFilterProvider>
  </SelectionProvider>
);

const paramsOf = (href: string) => new URLSearchParams(href.split("?")[1]);
const linkHref = (container: HTMLElement) => container.querySelector("a")!.getAttribute("href")!;
const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  track.mockClear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ["in-a", "in-b"] }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useFilterHides", () => {
  it("hides docs outside the selection while selected-only is on", () => {
    at("/atlas?id=in-a&subset=selected");
    const { result } = renderHook(() => useFilterHides(), { wrapper });
    expect(result.current("in-b")).toBe(false);
    expect(result.current("out")).toBe(true);
  });

  it("hides nothing in the All view, and nothing without the provider", () => {
    at("/atlas?id=in-a");
    expect(renderHook(() => useFilterHides(), { wrapper }).result.current("out")).toBe(false);
    at("/atlas?id=in-a&subset=selected");
    expect(renderHook(() => useFilterHides()).result.current("out")).toBe(false);
  });
});

describe("hiddenTargetHref", () => {
  it("opens beside the reader's doc, keeping its tab and filter", () => {
    const live = new URLSearchParams("id=cur&view=history&subset=selected&split=old&q=x");
    const { kind, href } = hiddenTargetHref("tgt", live);
    expect(kind).toBe("split");
    expect(Object.fromEntries(paramsOf(href))).toEqual({ id: "cur", view: "history", subset: "selected", split: "tgt" });
  });

  it("reads the target unfiltered when there is no reader doc to keep", () => {
    const { kind, href } = hiddenTargetHref("tgt", new URLSearchParams("subset=selected&q=x"));
    expect(kind).toBe("read");
    expect(Object.fromEntries(paramsOf(href))).toEqual({ id: "tgt" });
  });

  it("stays put when the target is already the reader's doc", () => {
    const { kind, href } = hiddenTargetHref("cur", new URLSearchParams("id=cur&subset=selected"));
    expect(kind).toBe("stay");
    expect(paramsOf(href).has("split")).toBe(false);
  });
});

describe("AtlasLink to a filter-hidden doc", () => {
  it("points at the split pane, and a plain click tracks the split open", () => {
    at("/atlas?id=in-a&subset=selected");
    const { container } = render(<AtlasLink to={atlasHref("out")}>go</AtlasLink>, { wrapper });
    expect(Object.fromEntries(paramsOf(linkHref(container)))).toEqual({ id: "in-a", subset: "selected", split: "out" });
    fireEvent.click(container.querySelector("a")!);
    expect(track).toHaveBeenCalledWith("atlas_split_open", { node_id: "in-a", split_id: "out", via: "filtered" });
  });

  it("still moves the reader to a doc the filter lists, with no split tracked", () => {
    at("/atlas?id=in-a&subset=selected");
    const { container } = render(<AtlasLink to={atlasHref("in-b")}>go</AtlasLink>, { wrapper });
    expect(paramsOf(linkHref(container)).get("id")).toBe("in-b");
    fireEvent.click(container.querySelector("a")!);
    expect(track).not.toHaveBeenCalled();
  });

  it("leaves a destination that names its own subset as written", () => {
    at("/atlas?id=in-a&subset=selected");
    const { container } = render(<AtlasLink to={`${atlasHref("out")}&subset=all`}>go</AtlasLink>, { wrapper });
    expect(Object.fromEntries(paramsOf(linkHref(container)))).toEqual({ id: "out", subset: "all" });
  });

  it("reads a destination that names a panel unfiltered, keeping that panel", () => {
    at("/atlas?id=in-a&subset=selected&split=cmp");
    const { container } = render(<AtlasLink to={atlasOnchainHref("out")}>go</AtlasLink>, { wrapper });
    expect(Object.fromEntries(paramsOf(linkHref(container)))).toEqual({ id: "out", view: "onchain", split: "cmp" });
  });

  it("does not track a click its caller handled", () => {
    at("/atlas?id=in-a&subset=selected");
    const handled = (e: { preventDefault: () => void }) => e.preventDefault();
    const { container } = render(<AtlasLink to={atlasHref("out")} onClick={handled}>go</AtlasLink>, { wrapper });
    fireEvent.click(container.querySelector("a")!);
    expect(track).not.toHaveBeenCalled();
  });
});

describe("the node navigator and the notice", () => {
  it("opens a hidden target in the split pane, tracking it once", () => {
    at("/atlas?id=in-a&subset=selected");
    const { result } = renderHook(() => useNavigateToNode(), { wrapper });
    result.current("out");
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({ id: "in-a", subset: "selected", split: "out" });
    result.current("out");
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("does nothing for the hidden doc the reader is already on", () => {
    at("/atlas?id=out&subset=selected");
    const { result } = renderHook(() => useNavigateToNode(), { wrapper });
    result.current("out");
    expect(window.location.search).toBe("?id=out&subset=selected");
  });

  it("notes a URL doc the filter hides, and show all lifts the filter", () => {
    at("/atlas?id=out&subset=selected");
    const { getByRole, queryByRole } = render(<FilteredOutNotice id="out" />, { wrapper });
    fireEvent.click(getByRole("button", { name: "show all" }));
    expect(new URLSearchParams(window.location.search).has("subset")).toBe(false);
    expect(queryByRole("status")).toBeNull();
  });
});
