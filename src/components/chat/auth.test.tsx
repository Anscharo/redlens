// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let enabled = true;
vi.mock("../../lib/usersEnabled", () => ({ usersEnabled: () => enabled }));

const { stashAuthReturn } = vi.hoisted(() => ({ stashAuthReturn: vi.fn() }));
vi.mock("../../lib/authReturn", () => ({ stashAuthReturn }));

import { AuthProvider, useAuth } from "./auth";

function Probe() {
  const { user, loading, openAuth, signOut } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user ? user.name ?? user.id : "none"}</div>
      <button onClick={() => openAuth("google")}>open</button>
      <button onClick={() => void signOut()}>signout</button>
    </div>
  );
}

let originalLocation: Location;
beforeEach(() => {
  originalLocation = window.location;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  enabled = true;
  Object.defineProperty(window, "location", { value: originalLocation, writable: true });
});

describe("AuthProvider when users are disabled", () => {
  it("skips the boot probe entirely and resolves loading=false, signed-out", async () => {
    enabled = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("AuthProvider when users are enabled", () => {
  it("bootstraps the user from a successful /api/auth/me", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "u1", name: "Ada", avatarUrl: "a.png", provider: "github", email: null }),
    } as Response);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Ada"));
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("treats a non-ok response (401) as signed-out", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("treats a network error as signed-out without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("openAuth stashes the return path and redirects to the provider's OAuth URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response);
    Object.defineProperty(window, "location", {
      value: { pathname: "/radar/foo", search: "?x=1", href: "" },
      writable: true,
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    screen.getByText("open").click();
    expect(stashAuthReturn).toHaveBeenCalledWith("/radar/foo?x=1");
    expect(window.location.href).toBe("/api/auth/google");
  });

  it("signOut posts to /api/auth/signout and clears the user even if the request fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "u1", name: "Ada", avatarUrl: "a.png", provider: "github", email: null }),
      } as Response)
      .mockRejectedValueOnce(new Error("boom"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Ada"));
    screen.getByText("signout").click();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/signout", { method: "POST", credentials: "same-origin" });
  });
});

describe("useAuth outside a provider", () => {
  it("throws a clear error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used within <AuthProvider>");
    spy.mockRestore();
  });
});
