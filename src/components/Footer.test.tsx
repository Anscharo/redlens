// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Footer } from "./Footer";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useSWUpdate } from "../hooks/useSWUpdate";
import { useAtlasVersion } from "../hooks/useAtlasVersion";
import { loadAtlas } from "../lib/docs";
import { loadHealth } from "../lib/health";
import { useDataSource } from "../lib/dataSource";

vi.mock("../hooks/useOnlineStatus", () => ({ useOnlineStatus: vi.fn() }));
vi.mock("../hooks/useSWUpdate", () => ({ useSWUpdate: vi.fn() }));
vi.mock("../hooks/useAtlasVersion", () => ({ useAtlasVersion: vi.fn() }));
vi.mock("../lib/docs", () => ({ loadAtlas: vi.fn() }));
vi.mock("../lib/health", () => ({ loadHealth: vi.fn() }));
vi.mock("../lib/dataSource", () => ({ useDataSource: vi.fn() }));

const applyUpdate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useOnlineStatus as unknown as Mock).mockReturnValue(true);
  (useSWUpdate as unknown as Mock).mockReturnValue({ needRefresh: false, applyUpdate });
  (useAtlasVersion as unknown as Mock).mockReturnValue(false);
  (useDataSource as unknown as Mock).mockReturnValue({ base: "/", preview: null });
  (loadHealth as unknown as Mock).mockResolvedValue(null);
  (loadAtlas as unknown as Mock).mockResolvedValue({ atlasCommit: "abc123def456", docs: {} });

  vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("chain-state.json")) {
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }
    if (u.includes("meta.json")) {
      return Promise.resolve(new Response(JSON.stringify({ repo: "some/preview-repo" }), { status: 200 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });

  Object.defineProperty(window, "location", {
    value: { ...window.location, reload: vi.fn() },
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Footer", () => {
  it("renders build info and the app commit link with no status pills when everything is fine", async () => {
    render(<Footer />);
    // App commit + build date are always present (no async dependency). The
    // src link now carries the build commit: text "src <sha>", href → the commit.
    expect(screen.getByText("test", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("src", { exact: false }).closest("a")).toHaveAttribute(
      "href",
      "https://github.com/test/test/commit/test",
    );
    expect(screen.getByText("provenance").closest("a")).toHaveAttribute("href", "/provenance");
    expect(screen.getByText("privacy").closest("a")).toHaveAttribute("href", "/privacy");
    expect(screen.queryByText("offline")).toBeNull();
    expect(screen.queryByText(/update available/)).toBeNull();
    expect(screen.queryByText(/atlas updated/)).toBeNull();
  });

  it("shows the offline pill when useOnlineStatus reports offline", () => {
    (useOnlineStatus as unknown as Mock).mockReturnValue(false);
    render(<Footer />);
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("shows an update-available pill that calls applyUpdate on click", () => {
    (useSWUpdate as unknown as Mock).mockReturnValue({ needRefresh: true, applyUpdate });
    render(<Footer />);
    const btn = screen.getByText(/update available/);
    fireEvent.click(btn);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  // applyUpdate waits on the service worker to activate before it reloads, so
  // without this the click had no visible effect for a second or more and read
  // as dropped. The spin is the acknowledgement; disabling stops the re-clicks
  // that produced.
  it("spins the pill's glyph and locks it once an update is being applied", () => {
    (useSWUpdate as unknown as Mock).mockReturnValue({ needRefresh: true, applyUpdate });
    render(<Footer />);
    const btn = screen.getByText(/update available/) as HTMLButtonElement;
    expect(btn.querySelector(".status-pill-glyph")).not.toBeNull();
    expect(btn).not.toHaveClass("is-applying");
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    expect(btn).toHaveClass("is-applying");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");

    // A second click can't re-enter applyUpdate — the update is already going.
    fireEvent.click(btn);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows an atlas-updated pill that reloads the page on click", () => {
    (useAtlasVersion as unknown as Mock).mockReturnValue(true);
    render(<Footer />);
    const btn = screen.getByText(/atlas updated/);
    fireEvent.click(btn);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("renders the chain-state block link once the block is fetched", async () => {
    (globalThis.fetch as unknown as Mock).mockImplementation((url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("chain-state.json")) {
        return Promise.resolve(new Response(JSON.stringify({ block: "12345678" }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    render(<Footer />);
    await waitFor(() => expect(screen.getByText("12,345,678")).toBeInTheDocument());
    expect(screen.getByText("12,345,678").closest("a")).toHaveAttribute(
      "href",
      "https://etherscan.io/block/12345678",
    );
  });

  it("renders the atlas commit + node count once health resolves (live mode)", async () => {
    (loadHealth as unknown as Mock).mockResolvedValue({ status: "ok", atlas_sha: "0123456789abcdef", docs: 42 });
    render(<Footer />);
    await waitFor(() => expect(screen.getByText("0123456")).toBeInTheDocument());
    expect(screen.getByText("0123456").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/sky-ecosystem/next-gen-atlas/commit/0123456789abcdef",
    );
    expect(screen.getByText("42", { exact: false })).toBeInTheDocument();
  });

  it("reads commit + count from loadAtlas (not loadHealth) in preview mode, and shows the preview repo", async () => {
    (useDataSource as unknown as Mock).mockReturnValue({
      base: "/api/preview/xyz/",
      preview: { id: "xyz", sha: "abc123def456" },
    });
    (loadAtlas as unknown as Mock).mockResolvedValue({
      atlasCommit: "fedcba9876543210",
      docs: { a: {}, b: {}, c: {} },
    });
    render(<Footer />);
    await waitFor(() => expect(screen.getByText("fedcba9")).toBeInTheDocument());
    expect(screen.getByText("fedcba9").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/some/preview-repo/commit/fedcba9876543210",
    );
    expect(loadHealth).not.toHaveBeenCalled();
    expect(useAtlasVersion).toHaveBeenCalledWith(null);
  });
});
