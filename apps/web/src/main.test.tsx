// @vitest-environment jsdom
// main.tsx is the bootstrap: it mounts <Root/> into #root and, before the
// Router reads the URL, branches on the pathname to serve the preview index,
// a preview gate, or the live app. We mock the heavy provider stack + App and
// drive each of the three pathname branches, asserting the right surface mounts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";

const restoreAuthReturn = vi.hoisted(() => vi.fn());

vi.mock("./index.css", () => ({}));
vi.mock("./App.tsx", () => ({ default: () => <div data-testid="live-app">live app</div> }));
vi.mock("./components/chat/auth", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./lib/selection", () => ({
  SelectionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./components/preview/PreviewGate", () => ({
  PreviewGate: ({ id, routerBase }: { id: string; routerBase: string }) => (
    <div data-testid="preview-gate">gate:{id}:{routerBase}</div>
  ),
}));
vi.mock("./components/preview/PreviewHome", () => ({
  PreviewHome: () => <div data-testid="preview-home">preview home</div>,
}));
vi.mock("./lib/authReturn", () => ({ restoreAuthReturn }));

function setPath(pathname: string) {
  window.history.pushState({}, "", pathname);
}

beforeEach(() => {
  vi.resetModules();
  restoreAuthReturn.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("main.tsx bootstrap", () => {
  it("mounts the live app for a normal path and restores any OAuth return", async () => {
    setPath("/atlas?id=x");
    await import("./main.tsx");
    // StrictMode + async root render — allow the commit to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("root")!.textContent).toContain("live app");
    expect(restoreAuthReturn).toHaveBeenCalled();
  });

  it("mounts the preview index at /preview", async () => {
    setPath("/preview");
    await import("./main.tsx");
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("root")!.textContent).toContain("preview home");
    // Live-only auth restore must not run on the preview surface.
    expect(restoreAuthReturn).not.toHaveBeenCalled();
  });

  it("mounts the preview gate for /preview/:id with the decoded id + router base", async () => {
    setPath("/preview/my-branch/atlas");
    await import("./main.tsx");
    await new Promise((r) => setTimeout(r, 0));
    const txt = document.getElementById("root")!.textContent!;
    expect(txt).toContain("gate:my-branch:/preview/my-branch");
    expect(restoreAuthReturn).not.toHaveBeenCalled();
  });
});
