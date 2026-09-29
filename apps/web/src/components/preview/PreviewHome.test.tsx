// @vitest-environment jsdom
// PreviewHome lists "my recent previews" as the INTERSECTION of this browser's
// localStorage opens and what's still live in the DB (AND-semantics), and parses
// pasted input into a preview id to gate the Preview button. fetch + localStorage
// are driven directly; parsePreviewInput runs for real.
//
// The DB side must be GET /api/preview/mine (sha-scoped, session-authorized),
// never the public /list — /list drops every private row, which made private
// previews vanish from this tab. Asserted below, since the bug is invisible in a
// test that only mocks "some fetch".

import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// The private-repo form (and the profile button) are gated on usersEnabled(),
// which is compiled off in the vitest build (__USERS_ENABLED__ = false). Mock it
// so we can drive both states: `h.usersOn` toggles it per test.
const h = vi.hoisted(() => ({ usersOn: false, user: null as { id: string } | null }));
vi.mock("../../lib/usersEnabled", () => ({ usersEnabled: () => h.usersOn }));
// PreviewHome reads useAuth() to know whether there is an account history to ask
// for (and to word the empty state). The real hook needs an AuthProvider + a
// /api/auth/me round trip; `h.user` drives it directly instead.
vi.mock("../chat/auth", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
// ProfileButton needs an AuthProvider (supplied by main.tsx in production, not in
// this isolated render); stub it — these tests are about the private form, not it.
vi.mock("../chat/ProfileButton", () => ({ ProfileButton: () => null }));
// Capture analytics track() calls to assert the private form doesn't leak the repo id.
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../lib/analytics", () => ({
  initAnalytics: () => {},
  register: () => {},
  pageview: () => {},
  track: analytics.track,
}));

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
  h.user = null;
  mockList([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  h.usersOn = false;
  h.user = null;
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

  it("asks /api/preview/mine for exactly the shas this browser remembers", async () => {
    localStorage.setItem(
      "preview-history",
      JSON.stringify([
        { id: "pull-1", sha: "aaa", at: 100 },
        { id: "acme:secret-atlas:main", sha: "bbb", at: 200 },
      ]),
    );
    mockList([]);
    render(<PreviewHome />);
    await screen.findByPlaceholderText(/Paste a next-gen-atlas/);

    const url = String(vi.mocked(globalThis.fetch).mock.calls[0]![0]);
    expect(url).toContain("api/preview/mine?shas=");
    expect(url).toContain("aaa");
    expect(url).toContain("bbb");
    expect(url).not.toContain("api/preview/list");
  });

  it("makes no request at all when this browser has opened nothing and nobody is signed in", async () => {
    mockList([]);
    render(<PreviewHome />);
    await screen.findByPlaceholderText(/Paste a next-gen-atlas/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("lists a private preview the server authorized, tagged private", async () => {
    localStorage.setItem("preview-history", JSON.stringify([{ id: "acme:secret-atlas:main", sha: "bbb", at: 1 }]));
    mockList([
      dbRow({ sha: "bbb", repo: "acme/secret-atlas", kind: "branch", pr_number: null, pr_state: null, private: true, doc_count: 12 }),
    ]);
    render(<PreviewHome />);

    expect(await screen.findByText("my recent previews · 1")).toBeInTheDocument();
    expect(screen.getByText("acme:secret-atlas:main")).toBeInTheDocument();
    expect(screen.getByText("private · 12 docs")).toBeInTheDocument();
  });

  it("lists a signed-in account's opens even when this browser has no record of them", async () => {
    h.usersOn = true;
    h.user = { id: "user-1" };
    // Nothing in localStorage: this is the other-browser case the account history exists for.
    mockList([
      dbRow({ sha: "ccc", pr_title: "Opened elsewhere", pr_author: "me", doc_count: 3, preview_id: "pull-7", opened_at: "2026-09-20T00:00:00Z" }),
    ]);
    render(<PreviewHome />);

    expect(await screen.findByText("my recent previews · 1")).toBeInTheDocument();
    expect(screen.getByText("pull-7")).toBeInTheDocument();
    expect(screen.getByText("Opened elsewhere")).toBeInTheDocument();
    // Signed in, the list spans browsers — the empty-state promise must not say otherwise.
    expect(screen.queryByText(/No previews opened/)).toBeNull();
  });

  it("asks the server even with an empty localStorage when signed in, and not when signed out", async () => {
    h.usersOn = true;
    h.user = { id: "user-1" };
    mockList([]);
    render(<PreviewHome />);
    await screen.findByPlaceholderText(/Paste a next-gen-atlas/);
    expect(String(vi.mocked(globalThis.fetch).mock.calls[0]![0])).toContain("api/preview/mine?shas=");
  });

  it("words the empty state for the account, not the browser, when signed in", async () => {
    h.usersOn = true;
    h.user = { id: "user-1" };
    mockList([]);
    render(<PreviewHome />);
    expect(await screen.findByText("No previews opened yet.")).toBeInTheDocument();
  });

  it("clears the account's rows on sign-out instead of leaving them on screen", async () => {
    h.usersOn = true;
    h.user = { id: "user-1" };
    // A private preview from the account history — nothing in localStorage, so
    // after sign-out there is nothing left to legitimately show.
    mockList([
      dbRow({ sha: "ccc", repo: "acme/secret-atlas", private: true, pr_title: "Secret work", preview_id: "acme:secret-atlas:main", opened_at: "2026-09-20T00:00:00Z" }),
    ]);
    const view = render(<PreviewHome />);
    expect(await screen.findByText("Secret work")).toBeInTheDocument();

    h.user = null; // signed out — the next person at this browser must not see it
    view.rerender(<PreviewHome />);
    expect(await screen.findByText("No previews opened in this browser yet.")).toBeInTheDocument();
    expect(screen.queryByText("Secret work")).toBeNull();
  });

  it("clears on sign-out even while the replacement fetch is still in flight", async () => {
    h.usersOn = true;
    h.user = { id: "user-1" };
    localStorage.setItem("preview-history", JSON.stringify([{ id: "pull-1", sha: "aaa", at: 5 }]));
    // First load resolves; the post-sign-out refetch never does, standing in for a
    // slow or failed request. The private row must go the moment the user changes,
    // not whenever (or if) that fetch lands.
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                dbRow({ sha: "ccc", repo: "acme/secret-atlas", private: true, pr_title: "Secret work", preview_id: "acme:secret-atlas:main", opened_at: "2026-09-20T00:00:00Z" }),
              ]),
          } as Response)
        : new Promise<Response>(() => {});
    });
    const view = render(<PreviewHome />);
    expect(await screen.findByText("Secret work")).toBeInTheDocument();

    h.user = null;
    view.rerender(<PreviewHome />);
    expect(screen.queryByText("Secret work")).toBeNull();
  });

  it("still lists previews under StrictMode, whose second fetch the server rate-limits", async () => {
    h.usersOn = true;
    h.user = { id: "user-1" };
    localStorage.setItem("preview-history", JSON.stringify([{ id: "pull-1", sha: "aaa", at: 5 }]));
    // StrictMode double-invokes the effect in dev, and the server holds an
    // account to one /mine per interval — so the second call 429s. Neither the
    // teardown of the first effect nor the refused second answer may blank the
    // list, or dev permanently reads "you have no recent previews".
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([dbRow({ sha: "aaa", pr_title: "First PR" })]) } as Response);
      }
      // The refusal LANDS LAST, as a real round trip would. Resolving it inline
      // would let it settle a microtask ahead of the first answer's .json() hop
      // and be harmlessly overwritten — hiding whether the list actually
      // survives a 429 or just wins a race.
      return new Promise<Response>((resolve) =>
        setTimeout(() => resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: "rate-limited" }) } as Response), 10),
      );
    });

    render(
      <StrictMode>
        <PreviewHome />
      </StrictMode>,
    );
    expect(await screen.findByText("First PR")).toBeInTheDocument();
    await waitFor(() => expect(call).toBe(2)); // the double-invoke really happened
    // Assert AFTER the refused response has settled — checking only on arrival of
    // the first would pass even if the 429 then blanked the list.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.getByText("First PR")).toBeInTheDocument();
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

  it("notes that a pasted PR URL will compare against its own base branch", () => {
    render(<PreviewHome />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
      target: { value: "https://github.com/acme/secret-atlas/pull/42" },
    });
    expect(screen.getByText("will compare with the pull request's base branch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview private repo" })).not.toBeDisabled();
  });

  it("notes that a pasted branch will compare against the repo's default branch, or live sky main when there is none", () => {
    render(<PreviewHome />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "acme/secret-atlas@main" } });
    expect(
      screen.getByText(
        "will compare with this repo's default branch, or with the live sky-ecosystem/next-gen-atlas:main when there is none to compare against",
      ),
    ).toBeInTheDocument();
  });

  // (input, expected preview-id) — covers every accepted private-input shape.
  const cases: [string, string][] = [
    ["acme/secret-atlas@feature/foo", "acme:secret-atlas:feature~foo"], // owner/repo@branch, slash → ~
    ["acme/secret-atlas", "acme:secret-atlas:HEAD"], // owner/repo, default branch
    ["https://github.com/acme/secret-atlas", "acme:secret-atlas:HEAD"], // full URL, default branch
    ["github.com/acme/secret-atlas.git", "acme:secret-atlas:HEAD"], // URL, .git suffix, default branch
    ["https://github.com/acme/secret-atlas/tree/feature/foo", "acme:secret-atlas:feature~foo"], // URL + branch
    ["https://github.com/acme/secret-atlas/pull/42", "acme:secret-atlas:pull-42"], // PR URL
    ["https://github.com/acme/secret-atlas/pull/42/files", "acme:secret-atlas:pull-42"], // PR URL + tab
    ["acme/secret-atlas.git", "acme:secret-atlas:HEAD"], // bare owner/repo.git, default branch
    ["acme/secret-atlas.git@main", "acme:secret-atlas:main"], // bare owner/repo.git@branch
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

  it("does not send the private repo/branch identifier to analytics on submit", () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { value: { ...originalLocation, href: "" }, writable: true });
    analytics.track.mockClear();

    render(<PreviewHome />);
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: "acme/secret-atlas@main" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview private repo" }));

    const call = analytics.track.mock.calls.find(([ev]) => ev === "preview_submit");
    expect(call).toBeTruthy();
    const payload = call![1] as Record<string, unknown>;
    expect(payload).toMatchObject({ private: true, parsed: true });
    // The repo identifier must NOT leave the browser for the private form.
    expect(payload).not.toHaveProperty("input");
    expect(payload).not.toHaveProperty("parsed_id");
    Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  });
});
