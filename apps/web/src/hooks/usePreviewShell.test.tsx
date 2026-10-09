// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, renderHook, act, cleanup, screen, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { usePreviewShell } from "./usePreviewShell";
import { useDocumentTitle } from "./useDocumentTitle";

const dataSource = vi.hoisted(() => ({ preview: false }));
vi.mock("../lib/dataSource", () => ({ useDataSource: () => dataSource }));

const DEFAULT_TITLE = "Redline Portal";

// The hook reads ?q= through wouter, so the router's search must match the
// location the test passes in.
function wrapperFor(search: string) {
  const { hook, searchHook } = memoryLocation({ path: `/${search ? `?${search}` : ""}` });
  return ({ children }: { children: React.ReactNode }) => (
    <Router hook={hook} searchHook={searchHook}>
      {children}
    </Router>
  );
}

function renderShell(location: string, search = "") {
  const navigate = vi.fn();
  const view = renderHook(({ loc }) => usePreviewShell(loc, navigate), {
    initialProps: { loc: location },
    wrapper: wrapperFor(search),
  });
  return { navigate, ...view };
}

beforeEach(() => {
  dataSource.preview = false;
  document.title = "Page — Redline Portal";
});

afterEach(cleanup);

describe("usePreviewShell redirect", () => {
  it("sends the bare root to the reader in a preview, replacing the history entry", () => {
    dataSource.preview = true;
    const { navigate } = renderShell("/");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/atlas", { replace: true });
  });

  it("leaves the root alone outside a preview", () => {
    const { navigate } = renderShell("/");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps a search on the root, where its results render", () => {
    dataSource.preview = true;
    const { navigate } = renderShell("/", "q=fees");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("treats an empty ?q= as the bare root", () => {
    dataSource.preview = true;
    const { navigate } = renderShell("/", "q=");
    expect(navigate).toHaveBeenCalledWith("/atlas", { replace: true });
  });

  it("keeps a search when other params ride along", () => {
    dataSource.preview = true;
    const { navigate } = renderShell("/", "split=abc&q=fees");
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["/atlas", "/radar", "/reports", "/search-hints"])("does not redirect %s", (location) => {
    dataSource.preview = true;
    const { navigate } = renderShell(location);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects when navigation lands on the bare root", () => {
    dataSource.preview = true;
    const { navigate, rerender } = renderShell("/atlas");
    expect(navigate).not.toHaveBeenCalled();
    rerender({ loc: "/" });
    expect(navigate).toHaveBeenCalledWith("/atlas", { replace: true });
  });

  it("redirects once the data source becomes a preview", () => {
    const { navigate, rerender } = renderShell("/");
    expect(navigate).not.toHaveBeenCalled();
    dataSource.preview = true;
    rerender({ loc: "/" });
    expect(navigate).toHaveBeenCalledWith("/atlas", { replace: true });
  });

  it("does not redirect again on a re-render with nothing changed", () => {
    dataSource.preview = true;
    const { navigate, rerender } = renderShell("/");
    rerender({ loc: "/" });
    rerender({ loc: "/" });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("usePreviewShell tab title", () => {
  it("leaves the page's title alone until the banner reports one", () => {
    renderShell("/atlas");
    expect(document.title).toBe("Page — Redline Portal");
  });

  it("sets the tab title the banner reports", () => {
    const { result } = renderShell("/atlas");
    act(() => result.current("PR #12 · Preview — Redline Portal"));
    expect(document.title).toBe("PR #12 · Preview — Redline Portal");
  });

  it("follows a changed tab title", () => {
    const { result } = renderShell("/atlas");
    act(() => result.current("PR #12 · Loading — Redline Portal"));
    act(() => result.current("PR #12 · Fix fees — Redline Portal"));
    expect(document.title).toBe("PR #12 · Fix fees — Redline Portal");
  });

  it("restores the default title when the banner clears its title", () => {
    const { result } = renderShell("/atlas");
    act(() => result.current("PR #12 · Preview — Redline Portal"));
    act(() => result.current(null));
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it("restores the default title when the shell unmounts", () => {
    const { result, unmount } = renderShell("/atlas");
    act(() => result.current("PR #12 · Preview — Redline Portal"));
    unmount();
    expect(document.title).toBe(DEFAULT_TITLE);
  });

  it("returns the same setter on every render, so the banner's effect does not re-run", () => {
    const { result, rerender } = renderShell("/atlas");
    const setter = result.current;
    act(() => setter("PR #12 · Preview — Redline Portal"));
    rerender({ loc: "/radar" });
    expect(result.current).toBe(setter);
  });

  // The contract the hook's doc comment states: the shell's title effect runs
  // after the open page's, so the preview's tab title wins.
  it("wins over a title the open page sets in the same render", () => {
    function Page({ title }: { title: string }) {
      useDocumentTitle(title);
      return null;
    }
    function Shell() {
      const setPreviewTab = usePreviewShell("/atlas", vi.fn());
      const [pageTitle, setPageTitle] = useState("Doc A — Redline Portal");
      return (
        <>
          <button type="button" onClick={() => setPreviewTab("PR #12 · Preview — Redline Portal")}>
            preview
          </button>
          <button type="button" onClick={() => setPageTitle("Doc B — Redline Portal")}>
            page
          </button>
          <Page title={pageTitle} />
        </>
      );
    }
    render(<Shell />, { wrapper: wrapperFor("") });
    expect(document.title).toBe("Doc A — Redline Portal");
    fireEvent.click(screen.getByText("preview"));
    expect(document.title).toBe("PR #12 · Preview — Redline Portal");
  });

  // Wired as App wires it: the banner reports its title from an effect (and
  // clears it on unmount), next to a page that sets its own title.
  function Banner({ onTabTitle }: { onTabTitle: (t: string | null) => void }) {
    useEffect(() => {
      onTabTitle("PR #12 · Preview — Redline Portal");
      return () => onTabTitle(null);
    }, [onTabTitle]);
    return null;
  }
  function Page() {
    useDocumentTitle("Doc A — Redline Portal");
    return null;
  }
  function App({ banner }: { banner: boolean }) {
    const setPreviewTab = usePreviewShell("/atlas", vi.fn());
    return (
      <>
        {banner && <Banner onTabTitle={setPreviewTab} />}
        <Page />
      </>
    );
  }

  it("wins over the page's title when the shell, banner and page mount together", () => {
    render(<App banner />, { wrapper: wrapperFor("") });
    expect(document.title).toBe("PR #12 · Preview — Redline Portal");
  });

  it("hands the tab back to the default title when the banner unmounts", () => {
    const { rerender } = render(<App banner />, { wrapper: wrapperFor("") });
    rerender(<App banner={false} />);
    expect(document.title).toBe(DEFAULT_TITLE);
  });
});
