// @vitest-environment jsdom
// PreviewHome lists "my recent previews" as the INTERSECTION of this browser's
// localStorage opens and what's still live in the DB (AND-semantics), and parses
// pasted input into a preview id to gate the Preview button. fetch + localStorage
// are driven directly; parsePreviewInput runs for real.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// The private-repo form (and the profile button) are gated on usersEnabled(),
// which is compiled off in the vitest build (__USERS_ENABLED__ = false). Mock it
// so we can drive both states: `h.usersOn` toggles it per test.
const h = vi.hoisted(() => ({ usersOn: false }));
vi.mock("../../lib/usersEnabled", () => ({ usersEnabled: () => h.usersOn }));
// ProfileButton needs an AuthProvider (supplied by main.tsx in production, not in
// this isolated render); stub it — these tests are about the private form, not it.
vi.mock("../chat/ProfileButton", () => ({ ProfileButton: () => null }));

import { PreviewHome } from "./PreviewHome";

function dbRow(over: Record<string, unknown>) {
  return {
    sha: "aaa", repo: "sky-ecosystem/next-gen-atlas", ref: "x", kind: "pr",
    pr_number: 1, pr_title: null, pr_author: null, pr_state: "open",
    doc_count: 0, last_access: "", ...over,
  };
}

function mockList(rows: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(rows),
  } as Response);
}

beforeEach(() => {
  localStorage.clear();
  h.usersOn = false;
  mockList([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  h.usersOn = false;
});

describe("PreviewHome recent list (AND-semantics)", () => {
  it("shows only previews present in BOTH localStorage and the DB", async () => {
    localStorage.setItem(
      "preview-history",
      JSON.stringify([
        { id: "pull-1", sha: "aaa", at: 100 },
        { id: "pull-2", sha: "bbb", at: 200 }, // not live in DB → hidden
      ]),
    );
    mockList([dbRow({ sha: "aaa", pr_title: "First PR", pr_author: "alice", doc_count: 5 })]);

    render(<PreviewHome />);

    expect(await screen.findByText("my recent previews · 1")).toBeInTheDocument();
    expect(screen.getByText("pull-1")).toBeInTheDocument();
    expect(screen.queryByText("pull-2")).toBeNull();
    expect(screen.getByText("First PR")).toBeInTheDocument();
    expect(screen.getByText("by alice · 5 docs")).toBeInTheDocument();
  });

  it("shows an empty recent tab (no count) when there's no intersection", async () => {
    localStorage.setItem("preview-history", JSON.stringify([{ id: "pull-9", sha: "zzz", at: 1 }]));
    mockList([dbRow({ sha: "aaa" })]);
    render(<PreviewHome />);
    await screen.findByPlaceholderText(/Paste a next-gen-atlas/);
    // The tab is always present, but unbadged and with an empty-state message.
    expect(screen.getByText("my recent previews")).toBeInTheDocument();
    expect(screen.queryByText(/my recent previews · /)).toBeNull();
    expect(screen.getByText(/No previews opened in this browser yet/)).toBeInTheDocument();
  });
});

describe("PreviewHome open-atlas-prs tab", () => {
  it("lazily loads and lists open PRs when the tab is selected", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("open-prs")
        ? [{ number: 256, title: "Atomize docs", author: "bob", draft: false, updatedAt: "" }]
        : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
    });

    render(<PreviewHome />);
    // The open-prs fetch must not fire until the tab is selected.
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining("open-prs"));

    fireEvent.click(await screen.findByText("open atlas prs"));

    expect(await screen.findByText("Atomize docs")).toBeInTheDocument();
    expect(screen.getByText("#256")).toBeInTheDocument();
    expect(screen.getByText("by bob")).toBeInTheDocument();
    // Linked into the preview gate as pull-256.
    expect(screen.getByText("Atomize docs").closest("a")?.getAttribute("href")).toContain("preview/pull-256");
  });

  it("recovers via Retry after an open-prs fetch failure", async () => {
    let openPrsCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("open-prs")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
      }
      openPrsCalls++;
      // First load fails; the retry succeeds.
      return openPrsCalls === 1
        ? Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ number: 9, title: "Recovered PR", author: "amy", draft: false, updatedAt: "" }]),
          } as Response);
    });

    render(<PreviewHome />);
    fireEvent.click(await screen.findByText("open atlas prs"));

    // Error state with a working Retry affordance (not a latched empty list).
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    expect(await screen.findByText("Recovered PR")).toBeInTheDocument();
    expect(openPrsCalls).toBe(2);
  });
});

describe("PreviewHome input parsing", () => {
  it("disables the Preview button until the input parses to an id", () => {
    render(<PreviewHome />);
    const button = screen.getByRole("button", { name: "Preview" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Paste/), { target: { value: "pull-256" } });
    expect(button).not.toBeDisabled();
  });

  it("shows a parse-error hint for unparseable input", () => {
    render(<PreviewHome />);
    fireEvent.change(screen.getByPlaceholderText(/Paste/), { target: { value: "not a valid ref" } });
    expect(screen.getByText(/Can't parse that/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });
});

describe("PreviewHome private repo form", () => {
  const PLACEHOLDER = /github\.com\/owner\/repo/;

  beforeEach(() => {
    h.usersOn = true; // logins enabled → the private form renders
  });

  it("is hidden entirely when logins are disabled for the environment", () => {
    h.usersOn = false;
    render(<PreviewHome />);
    expect(screen.queryByText("Preview a private repo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview private repo" })).toBeNull();
  });

  it("disables the private-preview button until the input parses", () => {
    render(<PreviewHome />);
    const button = screen.getByRole("button", { name: "Preview private repo" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "acme/secret-atlas@main" } });
    expect(button).not.toBeDisabled();
  });

  it("shows a hint for input that doesn't parse", () => {
    render(<PreviewHome />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "not a valid input" } });
    expect(screen.getByText(/Paste a github\.com\/owner\/repo URL/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview private repo" })).toBeDisabled();
  });

  // (input, expected preview-id) — covers every accepted private-input shape.
  const cases: [string, string][] = [
    ["acme/secret-atlas@feature/foo", "acme:secret-atlas:feature~foo"], // owner/repo@branch, slash → ~
    ["acme/secret-atlas", "acme:secret-atlas:HEAD"], // owner/repo, default branch
    ["https://github.com/acme/secret-atlas", "acme:secret-atlas:HEAD"], // full URL, default branch
    ["github.com/acme/secret-atlas.git", "acme:secret-atlas:HEAD"], // URL, .git suffix, default branch
    ["https://github.com/acme/secret-atlas/tree/feature/foo", "acme:secret-atlas:feature~foo"], // URL + branch
  ];
  for (const [input, id] of cases) {
    it(`parses "${input}" → ${id} and navigates on submit`, () => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", { value: { ...originalLocation, href: "" }, writable: true });

      render(<PreviewHome />);
      fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: input } });
      fireEvent.click(screen.getByRole("button", { name: "Preview private repo" }));

      expect(window.location.href).toContain(encodeURIComponent(id));
      Object.defineProperty(window, "location", { value: originalLocation, writable: true });
    });
  }
});
