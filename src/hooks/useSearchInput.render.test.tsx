// @vitest-environment jsdom
// Renders the useSearchInput hook end-to-end (the .test.ts sibling only covers
// the pure applyMode/isMixedQuotes helpers). We drive its handlers and assert
// the navigation shortcuts, URL-param writes, mode wrapping, and the search()
// side effect that feeds the results worker.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SearchScope } from "@/lib/routes";

const { search, track } = vi.hoisted(() => ({ search: vi.fn(), track: vi.fn() }));
vi.mock("./useSearch", () => ({
  useSearch: () => ({ state: { status: "idle", query: "", hits: [] }, search, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track }));
vi.mock("@/lib/recentSearches", () => ({
  useRecentSearches: () => [],
  useRecordRecentSearch: () => {},
}));

import { useSearchInput } from "./useSearchInput";

type Api = ReturnType<typeof useSearchInput>;
let api: Api;

function Harness({
  location,
  navigate,
  scope,
}: {
  location: string;
  navigate: (to: string) => void;
  scope: SearchScope;
}) {
  api = useSearchInput(location, navigate, scope);
  const r = useRef<HTMLInputElement>(null);
  // Wire the returned ref to a real input so focus()/setSelectionRange() paths run.
  return <input ref={api.inputRef as typeof r} />;
}

function setup(path: string, location: string, scope: SearchScope = "atlas") {
  const navigate = vi.fn();
  const { hook } = memoryLocation({ path, record: true });
  const wrapper = ({ children }: { children: ReactNode }) => <Router hook={hook}>{children}</Router>;
  render(<Harness location={location} navigate={navigate} scope={scope} />, { wrapper });
  return { navigate };
}

beforeEach(() => {
  search.mockClear();
  track.mockClear();
});
afterEach(() => cleanup());

describe("useSearchInput (rendered)", () => {
  it("reads the current query from ?q and exposes it", () => {
    setup("/?q=governance", "/");
    expect(api.query).toBe("governance");
  });

  it("on HOME, runs search() with the applied-mode query", () => {
    setup("/?q=governance&mode=phrase", "/");
    // effect fires search() with the phrase-wrapped query.
    expect(search).toHaveBeenCalled();
    expect(search).toHaveBeenLastCalledWith('"governance"');
  });

  it("off HOME, clears the search worker (search(''))", () => {
    setup("/atlas?q=governance", "/atlas");
    expect(search).toHaveBeenLastCalledWith("");
  });

  it("handleChange routes the /reports shortcut to the reports page", () => {
    const { navigate } = setup("/", "/");
    act(() => api.handleChange({ target: { value: "/reports" } } as never));
    expect(navigate).toHaveBeenCalledWith("/reports");
  });

  it("handleChange routes /radar and /h shortcuts", () => {
    const { navigate } = setup("/", "/");
    act(() => api.handleChange({ target: { value: "/radar" } } as never));
    expect(navigate).toHaveBeenCalledWith("/radar");
    act(() => api.handleChange({ target: { value: "/h" } } as never));
    expect(navigate).toHaveBeenCalledWith("/search-hints");
  });

  it("handleChange from a non-home atlas route redirects to HOME carrying ?q", () => {
    const { navigate } = setup("/atlas?id=x", "/atlas", "atlas");
    act(() => api.handleChange({ target: { value: "delegate" } } as never));
    expect(navigate).toHaveBeenCalledWith("/?q=delegate");
  });

  it("handleChange on HOME writes the query into the URL (?q)", () => {
    setup("/", "/", "atlas");
    act(() => api.handleChange({ target: { value: "risk" } } as never));
    expect(api.query).toBe("risk");
  });

  it("clearQuery empties the query", () => {
    setup("/?q=governance", "/", "atlas");
    act(() => api.clearQuery());
    expect(api.query).toBe("");
  });

  it("broadSearch sets broad mode and the query", () => {
    setup("/?q='exact'", "/", "atlas");
    act(() => api.broadSearch("plain text"));
    expect(api.query).toBe("plain text");
    expect(api.activeMode).toBe("broad");
  });

  it("handleHintClick navigates shortcuts and otherwise sets the query", () => {
    const { navigate } = setup("/", "/", "atlas");
    act(() => api.handleHintClick("/reports"));
    expect(navigate).toHaveBeenCalledWith("/reports");
    act(() => api.handleHintClick("fuzzy~2"));
    expect(api.query).toBe("fuzzy~2");
  });

  it("wrapModeClick wraps bare free text into a phrase and tracks the change", () => {
    setup("/?q=governance", "/", "atlas");
    act(() => api.wrapModeClick("phrase"));
    expect(track).toHaveBeenCalledWith("search_mode_change", { mode: "phrase" });
    expect(api.query).toBe('"governance"');
  });

  it("wrapModeClick toggles a phrase back off to bare text", () => {
    setup('/?q="governance"', "/", "atlas");
    // Already phrase-wrapped → clicking phrase again reverts to bare text.
    act(() => api.wrapModeClick("phrase"));
    expect(api.query).toBe("governance");
  });

  it("wrapModeClick with no free text inserts an empty quote pair", () => {
    setup("/", "/", "atlas");
    act(() => api.wrapModeClick("strict"));
    expect(api.query).toBe("''");
  });

  it("selectRecent tracks and navigates to the results page", () => {
    const { navigate } = setup("/radar", "/radar", "radar");
    act(() => api.selectRecent("delegate rewards", 0));
    expect(track).toHaveBeenCalledWith(
      "search_recent_select",
      expect.objectContaining({ query: "delegate rewards", rank: 1 }),
    );
    expect(navigate).toHaveBeenCalledWith("/?q=delegate+rewards");
  });

  it("derives phrase activeMode + isMixed from the visible query", () => {
    setup('/?q="clean phrase"', "/", "atlas");
    expect(api.activeMode).toBe("phrase");
    expect(api.isMixed).toBe(false);
    cleanup();
    setup('/?q=half "quoted', "/", "atlas");
    expect(api.isMixed).toBe(true);
  });
});
