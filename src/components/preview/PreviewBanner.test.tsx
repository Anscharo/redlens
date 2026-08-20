// @vitest-environment jsdom
// PreviewBanner renders the trust/provenance header from the bundle's meta.json.
// We mock the meta fetch and the data source to assert PR vs FORK treatment and
// the fork-only risk signals (new addresses, untrusted author).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreviewBanner } from "./PreviewBanner";
import { DataSourceContext, type DataSource } from "@/lib/dataSource";

function mockMeta(meta: Record<string, unknown> | null) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(meta),
  } as Response);
}

function renderBanner(source: DataSource) {
  return render(
    <DataSourceContext.Provider value={source}>
      <PreviewBanner />
    </DataSourceContext.Provider>,
  );
}

const PREVIEW_SOURCE: DataSource = {
  base: "/api/preview/abc/",
  preview: { id: "pr-88", sha: "abc" },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => mockMeta(null));

describe("PreviewBanner", () => {
  it("renders nothing when there is no active preview", () => {
    const { container } = renderBanner({ base: "/live/", preview: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders a PREVIEW header with a PR link for a PR preview", async () => {
    mockMeta({
      sha: "abc",
      repo: "sky-ecosystem/next-gen-atlas",
      ref: "feat/x",
      kind: "pr",
      prNumber: 88,
      prTitle: "Add a thing",
      prAuthor: "alice",
    });
    renderBanner(PREVIEW_SOURCE);

    expect(await screen.findByText("PREVIEW")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "view PR on GitHub ↗" });
    expect(link).toHaveAttribute("href", "https://github.com/sky-ecosystem/next-gen-atlas/pull/88");
    expect(screen.getByText(/proposed by alice/)).toBeTruthy();
  });

  it("renders a FORK PREVIEW header with risk signals for an untrusted fork", async () => {
    mockMeta({
      sha: "def",
      repo: "mallory/next-gen-atlas",
      ref: "sneaky",
      kind: "branch",
      forkOwner: "mallory",
      trustTier: "unknown",
      newAddresses: 3,
    });
    renderBanner(PREVIEW_SOURCE);

    expect(await screen.findByText("FORK PREVIEW")).toBeTruthy();
    expect(screen.getByText("author has no PRs accepted into the atlas")).toBeTruthy();
    expect(screen.getByText(/3 new on-chain addresses/)).toBeTruthy();
  });

  it("falls back to the preview id before meta.json resolves", () => {
    // fetch unresolved → no meta yet; banner still renders using preview.id.
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}) as Promise<Response>);
    renderBanner(PREVIEW_SOURCE);
    expect(screen.getByText("PREVIEW")).toBeTruthy();
    expect(screen.getByText("pr-88")).toBeTruthy();
  });

  it("singularises the new-address warning for a single address", async () => {
    mockMeta({
      sha: "def", repo: "m/next-gen-atlas", ref: "x", kind: "branch",
      forkOwner: "m", newAddresses: 1,
    });
    renderBanner(PREVIEW_SOURCE);
    await waitFor(() => expect(screen.getByText(/1 new on-chain address$/)).toBeTruthy());
  });

  it("fails closed: warns when the address check could not be run", async () => {
    // addressCheckFailed (main's map was unreadable) must NOT read as "0 new
    // addresses" — the fork banner still warns rather than silently reassuring.
    mockMeta({
      sha: "def", repo: "m/next-gen-atlas", ref: "x", kind: "branch",
      forkOwner: "m", addressCheckFailed: true,
    });
    renderBanner(PREVIEW_SOURCE);
    await waitFor(() => expect(screen.getByText(/couldn't verify new on-chain addresses/)).toBeTruthy());
  });

  it("renders a PRIVATE PREVIEW chip and copy for a private preview, taking precedence over FORK/PREVIEW", async () => {
    mockMeta({
      sha: "ghi",
      repo: "acme/secret-atlas",
      ref: "feature",
      kind: "branch",
      private: true,
    });
    renderBanner(PREVIEW_SOURCE);

    expect(await screen.findByText("PRIVATE PREVIEW")).toBeTruthy();
    expect(screen.queryByText("PREVIEW")).toBeNull();
    expect(screen.queryByText("FORK PREVIEW")).toBeNull();
    expect(screen.getByText(/a private preview of/)).toBeTruthy();
  });

  it("shows the new-address safety warning for a private preview even though it's not a fork", async () => {
    // The server doesn't set forkOwner for private previews, so isFork is
    // false — the warning must be gated on private too, not just isFork.
    mockMeta({
      sha: "ghi", repo: "acme/secret-atlas", ref: "feature", kind: "branch",
      private: true, newAddresses: 2,
    });
    renderBanner(PREVIEW_SOURCE);
    await waitFor(() => expect(screen.getByText(/2 new on-chain addresses/)).toBeTruthy());
  });
});
