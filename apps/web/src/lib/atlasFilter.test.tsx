// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { renderHook, render, cleanup, fireEvent } from "@testing-library/react";
import { FilteredOutNotice } from "../components/atlas/FilteredOutNotice";
import type { ReactNode } from "react";
import { atlasHref } from "@/lib/routes";
import { splitHref, useFilterHides } from "./atlasFilter";
import { SelectionProvider } from "./selection";
import { STORAGE_KEY } from "./selectionStore";
import { AtlasLink } from "../components/AtlasLink";
import { useNavigateToNode } from "../hooks/useNavigation";

const wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>;

function hrefOf(container: HTMLElement): URLSearchParams {
  return new URLSearchParams(container.querySelector("a")!.getAttribute("href")!.split("?")[1]);
}

beforeEach(() => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ["in-a", "in-b"] }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useFilterHides", () => {
  it("hides docs outside the selection while selected-only is on", () => {
    window.history.replaceState(null, "", "/atlas?id=in-a&subset=selected");
    const { result } = renderHook(() => useFilterHides(), { wrapper });
    expect(result.current("in-b")).toBe(false);
    expect(result.current("out")).toBe(true);
  });

  it("hides nothing in the All view", () => {
    window.history.replaceState(null, "", "/atlas?id=in-a");
    const { result } = renderHook(() => useFilterHides(), { wrapper });
    expect(result.current("out")).toBe(false);
  });
});

describe("splitHref", () => {
  it("keeps the reader doc, tab and filter and puts the target in the split", () => {
    const live = new URLSearchParams("id=cur&view=history&subset=selected&split=old&q=x");
    const params = new URLSearchParams(splitHref("tgt", live).split("?")[1]);
    expect(params.get("id")).toBe("cur");
    expect(params.get("view")).toBe("history");
    expect(params.get("subset")).toBe("selected");
    expect(params.get("split")).toBe("tgt");
    expect(params.has("q")).toBe(false);
  });
});

describe("links to a filter-hidden doc", () => {
  it("AtlasLink points a hidden target at the split pane, leaving the reader doc", () => {
    window.history.replaceState(null, "", "/atlas?id=in-a&subset=selected");
    const { container } = render(<AtlasLink to={atlasHref("out")}>go</AtlasLink>, { wrapper });
    const params = hrefOf(container);
    expect(params.get("id")).toBe("in-a");
    expect(params.get("split")).toBe("out");
  });

  it("AtlasLink still moves the reader to a target the filter lists", () => {
    window.history.replaceState(null, "", "/atlas?id=in-a&subset=selected");
    const { container } = render(<AtlasLink to={atlasHref("in-b")}>go</AtlasLink>, { wrapper });
    const params = hrefOf(container);
    expect(params.get("id")).toBe("in-b");
    expect(params.has("split")).toBe(false);
  });

  it("the reader notes a URL doc the filter hides, and show all lifts the filter", () => {
    window.history.replaceState(null, "", "/atlas?id=out&subset=selected");
    const { getByRole, queryByRole } = render(<FilteredOutNotice id="out" />, { wrapper });
    fireEvent.click(getByRole("button", { name: "show all" }));
    expect(new URLSearchParams(window.location.search).has("subset")).toBe(false);
    expect(queryByRole("status")).toBeNull();
  });

  it("the node navigator opens a hidden target in the split pane", () => {
    window.history.replaceState(null, "", "/atlas?id=in-a&subset=selected");
    const { result } = renderHook(() => useNavigateToNode(), { wrapper });
    result.current("out");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("id")).toBe("in-a");
    expect(params.get("split")).toBe("out");
    expect(params.get("subset")).toBe("selected");
  });
});
