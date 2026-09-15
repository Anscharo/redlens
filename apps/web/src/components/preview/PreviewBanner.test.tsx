// @vitest-environment jsdom
// PreviewBanner renders the trust/provenance header from the bundle's meta.json.
// We mock the meta fetch and the data source to assert PR vs FORK treatment and
// the fork-only risk signals (new addresses, untrusted author).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PreviewBanner } from "./PreviewBanner";
import { DataSourceContext, type DataSource } from "../../lib/dataSource";
import type { ActiveBase } from "../../lib/previewMetaCopy";

let activeBaseValue: ActiveBase | null = null;
vi.mock("../../lib/previewDiff", () => ({
  usePreviewDiff: () => ({ activeBase: activeBaseValue }),
}));

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

// Under a nested <Router base>, a Link's href is `router.base + to` — composing
// the switch link with only the query string (dropping the current path) would
// navigate away from wherever the user is (e.g. back off of /atlas).
function renderBannerUnderRouter(source: DataSource, routerBase: string, path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router base={routerBase} hook={hook}>
      <DataSourceContext.Provider value={source}>
        <PreviewBanner />
      </DataSourceContext.Provider>
    </Router>,
  );
}

const PREVIEW_SOURCE: DataSource = {
  base: "/api/preview/abc/",
  preview: { id: "pr-88", sha: "abc" },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  activeBaseValue = null;
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

  it("links a private PR preview to the private repo's pull, not canonical", async () => {
    mockMeta({
      sha: "ghi",
      repo: "acme/secret-atlas",
      ref: "feature/spark",
      kind: "branch",
      private: true,
      prNumber: 42,
      prTitle: "Spark the atlas",
    });
    renderBanner(PREVIEW_SOURCE);

    expect(await screen.findByText("PRIVATE PREVIEW")).toBeTruthy();
    const link = await screen.findByRole("link", { name: "view PR on GitHub ↗" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/secret-atlas/pull/42");
  });

  it("links a private pull-N ref (Contents-only fallback) to the private repo's pull", async () => {
    mockMeta({
      sha: "ghi",
      repo: "acme/secret-atlas",
      ref: "pull-7",
      kind: "branch",
      private: true,
    });
    renderBanner(PREVIEW_SOURCE);

    const link = await screen.findByRole("link", { name: "view PR on GitHub ↗" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/secret-atlas/pull/7");
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

  it("renders the repo drift line for the repo base, in context", async () => {
    activeBaseValue = { key: "repo", repo: "acme/fork", ref: "main", auto: true };
    mockMeta({
      sha: "abc", repo: "acme/fork", ref: "main", kind: "pr", prNumber: 88,
      bases: {
        auto: "repo",
        sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" },
        repo: {
          repo: "acme/fork", ref: "main", mergeBase: "y",
          drift: { sha: "s", commitsAhead: 3, commitsBehind: 2, docsDiffer: 1, vsAtlasCommit: "v" },
        },
      },
    });
    renderBanner(PREVIEW_SOURCE);
    expect(
      await screen.findByText(
        /redlined against acme\/fork:main · base forked from sky-ecosystem\/next-gen-atlas:main 3 commits ago · 2 commits behind main · 1 doc differs/,
      ),
    ).toBeTruthy();
  });

  it("shows an 'N commits behind main' sky line for a private branch with no forkOwner", async () => {
    activeBaseValue = { key: "sky", repo: "acme/secret-atlas", ref: "feature", auto: true };
    mockMeta({
      sha: "ghi", repo: "acme/secret-atlas", ref: "feature", kind: "branch", private: true,
      bases: { auto: "sky", sky: { repo: "acme/secret-atlas", ref: "feature", mergeBase: "x", behindBy: 4 } },
    });
    renderBanner(PREVIEW_SOURCE);
    expect(await screen.findByText(/4 commits behind main/)).toBeTruthy();
  });

  it("shows the switch link only when both base candidates exist, pointing at ?base=", async () => {
    activeBaseValue = { key: "sky", repo: "sky-ecosystem/next-gen-atlas", ref: "main", auto: true };
    mockMeta({
      sha: "abc", repo: "acme/fork", ref: "main", kind: "pr", prNumber: 88,
      bases: {
        auto: "sky",
        sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" },
        repo: { repo: "acme/base", ref: "develop", mergeBase: "y" },
      },
    });
    renderBanner(PREVIEW_SOURCE);
    const link = await screen.findByRole("link", { name: "compare against acme/base:develop instead" });
    expect(link.getAttribute("href")).toContain("?base=repo");
  });

  it("preserves the current sub-route + other params when composing the switch link's href", async () => {
    activeBaseValue = { key: "sky", repo: "sky-ecosystem/next-gen-atlas", ref: "main", auto: true };
    mockMeta({
      sha: "abc", repo: "acme/fork", ref: "main", kind: "pr", prNumber: 88,
      bases: {
        auto: "sky",
        sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" },
        repo: { repo: "acme/base", ref: "develop", mergeBase: "y" },
      },
    });
    renderBannerUnderRouter(PREVIEW_SOURCE, "/preview/pr-88", "/preview/pr-88/atlas?subset=changed");
    const link = await screen.findByRole("link", { name: "compare against acme/base:develop instead" });
    expect(link.getAttribute("href")).toBe("/preview/pr-88/atlas?subset=changed&base=repo");
  });

  it("shows a 'back to' link when the URL forces a non-auto base", async () => {
    activeBaseValue = { key: "repo", repo: "acme/base", ref: "develop", auto: false };
    mockMeta({
      sha: "abc", repo: "acme/fork", ref: "main", kind: "pr", prNumber: 88,
      bases: {
        auto: "sky",
        sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" },
        repo: { repo: "acme/base", ref: "develop", mergeBase: "y" },
      },
    });
    renderBanner(PREVIEW_SOURCE);
    expect(await screen.findByRole("link", { name: "back to sky-ecosystem/next-gen-atlas:main" })).toBeTruthy();
  });

  it("omits the switch link when only one base candidate exists", async () => {
    activeBaseValue = { key: "sky", repo: "sky-ecosystem/next-gen-atlas", ref: "main", auto: true };
    mockMeta({
      sha: "abc", repo: "acme/fork", ref: "main", kind: "branch",
      bases: { auto: "sky", sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" } },
    });
    renderBanner(PREVIEW_SOURCE);
    await screen.findByText("PREVIEW");
    expect(screen.queryByText(/compare against|back to/)).toBeNull();
  });

  it("shows the degraded live-main note", async () => {
    activeBaseValue = { key: "live-main", auto: true };
    mockMeta({
      sha: "abc", repo: "acme/fork", ref: "main", kind: "branch",
      bases: { auto: "live-main", reason: "no fork point found" },
    });
    renderBanner(PREVIEW_SOURCE);
    expect(await screen.findByText(/redlined against live main \(no fork point found\)/)).toBeTruthy();
  });

  it("prompts to review GitHub App permissions on a private PR built without Pull requests: Read", async () => {
    mockMeta({
      sha: "ghi",
      repo: "acme/secret-atlas",
      ref: "pull-7",
      kind: "branch",
      private: true,
      needsPullsPermission: true,
      permissionsUrl: "https://github.com/organizations/acme/settings/installations/9/permissions/update",
    });
    renderBanner(PREVIEW_SOURCE);
    expect(await screen.findByText("PERMISSION")).toBeTruthy();
    expect(await screen.findByText(/Needs Pull requests: Read/)).toBeTruthy();
    const link = await screen.findByRole("link", { name: "Review permissions on GitHub ↗" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/organizations/acme/settings/installations/9/permissions/update",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("asks the owner to grant Pull requests: Read when there is no review URL", async () => {
    mockMeta({
      sha: "ghi", repo: "acme/secret-atlas", ref: "pull-7", kind: "branch",
      private: true, needsPullsPermission: true,
    });
    renderBanner(PREVIEW_SOURCE);
    expect(await screen.findByText(/Ask the person who installed the App/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review permissions on GitHub ↗" })).toBeNull();
  });

  it("omits the permission prompt when the flag is off", async () => {
    mockMeta({
      sha: "ghi", repo: "acme/secret-atlas", ref: "feature", kind: "branch", private: true,
    });
    renderBanner(PREVIEW_SOURCE);
    await screen.findByText("PRIVATE PREVIEW");
    expect(screen.queryByText(/Needs Pull requests: Read/)).toBeNull();
  });

  it("renders an old bundle (no bases field) exactly as before, unaffected by the new copy", async () => {
    mockMeta({
      sha: "def", repo: "mallory/next-gen-atlas", ref: "sneaky", kind: "branch",
      forkOwner: "mallory", behindBy: 5,
    });
    renderBanner(PREVIEW_SOURCE);
    expect(await screen.findByText(/5 commits behind main/)).toBeTruthy();
    expect(screen.queryByText(/redlined against/)).toBeNull();
  });
});
