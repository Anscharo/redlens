// @vitest-environment jsdom
// PreviewInterstitial gates first-visit access to low-trust preview content:
// untrusted forks and unknown-tier PR authors get a click-through warning;
// trusted forks / known-tier PRs / same-session-acked visits pass straight to
// children. Dismissal is per preview sha via sessionStorage.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreviewInterstitial } from "./PreviewInterstitial";

function mockMeta(meta: Record<string, unknown> | null) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: meta !== null,
    json: () => Promise.resolve(meta),
  } as Response);
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("PreviewInterstitial", () => {
  it("renders nothing while meta.json is loading", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}) as Promise<Response>);
    const { container } = render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("passes children straight through for a trusted-tier fork", async () => {
    mockMeta({ repo: "sky-ecosystem/next-gen-atlas", forkOwner: "sky-ecosystem", trustTier: "trusted" });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByTestId("child")).toBeInTheDocument();
  });

  it("passes children straight through for a known-tier PR (not a fork)", async () => {
    mockMeta({ repo: "sky-ecosystem/next-gen-atlas", prAuthor: "alice", trustTier: "known" });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByTestId("child")).toBeInTheDocument();
  });

  it("fails open (passes through) when the meta fetch fails", async () => {
    mockMeta(null);
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByTestId("child")).toBeInTheDocument();
  });

  it("shows the UNREVIEWED FORK warning for an untrusted fork", async () => {
    mockMeta({ repo: "mallory/next-gen-atlas", forkOwner: "mallory", trustTier: "unknown" });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByText("UNREVIEWED FORK")).toBeInTheDocument();
    expect(screen.queryByTestId("child")).toBeNull();
    expect(screen.getAllByText("mallory", { exact: false }).length).toBeGreaterThan(0);
  });

  it("shows the UNREVIEWED PROPOSAL warning for an unknown-tier PR author", async () => {
    mockMeta({ repo: "sky-ecosystem/next-gen-atlas", prAuthor: "bob", trustTier: "unknown" });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByText("UNREVIEWED PROPOSAL")).toBeInTheDocument();
    expect(screen.getByText(/pull request that has/)).toBeInTheDocument();
  });

  it("shows the new-addresses warning with correct pluralization", async () => {
    mockMeta({ repo: "mallory/next-gen-atlas", forkOwner: "mallory", trustTier: "unknown", newAddresses: 3 });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div>content</div>
      </PreviewInterstitial>,
    );
    expect(
      await screen.findByText((_, el) => el?.tagName === "P" && el?.textContent?.includes("3 on-chain addresses") === true),
    ).toBeInTheDocument();
  });

  it("singularises the new-address warning for exactly one address", async () => {
    mockMeta({ repo: "mallory/next-gen-atlas", forkOwner: "mallory", trustTier: "unknown", newAddresses: 1 });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div>content</div>
      </PreviewInterstitial>,
    );
    expect(
      await screen.findByText((_, el) => el?.tagName === "P" && el?.textContent?.includes("1 on-chain address ") === true),
    ).toBeInTheDocument();
  });

  it("shows the address-check-failed warning when the check could not run", async () => {
    mockMeta({ repo: "mallory/next-gen-atlas", forkOwner: "mallory", trustTier: "unknown", addressCheckFailed: true });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div>content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByText(/couldn't verify whether this fork introduces new on-chain addresses/i)).toBeInTheDocument();
  });

  it("dismisses on click-through, records sessionStorage, and reveals children", async () => {
    mockMeta({ repo: "mallory/next-gen-atlas", forkOwner: "mallory", trustTier: "unknown" });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    const proceedBtn = await screen.findByRole("button", { name: "I understand — view the fork" });
    fireEvent.click(proceedBtn);

    await waitFor(() => expect(screen.getByTestId("child")).toBeInTheDocument());
    expect(sessionStorage.getItem("preview-ack-abc")).toBe("1");
  });

  it("skips the interstitial entirely (no fetch) when already acked this session", async () => {
    sessionStorage.setItem("preview-ack-abc", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("has a back-to-live-atlas link that tracks a cancel event on click", async () => {
    mockMeta({ repo: "mallory/next-gen-atlas", forkOwner: "mallory", trustTier: "unknown" });
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div>content</div>
      </PreviewInterstitial>,
    );
    const back = await screen.findByText("← back to the live atlas");
    expect(back.closest("a")).toHaveAttribute("href", "/");
    // Clicking doesn't navigate in jsdom; just exercises the onClick handler.
    fireEvent.click(back);
  });

  it("fails open when the meta fetch rejects outright", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    render(
      <PreviewInterstitial sha="abc" base="/api/preview/abc/">
        <div data-testid="child">content</div>
      </PreviewInterstitial>,
    );
    expect(await screen.findByTestId("child")).toBeInTheDocument();
  });
});
