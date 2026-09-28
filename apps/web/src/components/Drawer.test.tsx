// @vitest-environment jsdom
import { it, expect, describe, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Drawer, DrawerToggle } from "./Drawer";

// jsdom doesn't implement matchMedia; stub it so useIsNarrow can subscribe
// to a "change" listener and we can flip `matches` from the test.
function stubMatchMedia(initialMatches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches: initialMatches,
    media: "",
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  // jsdom doesn't implement matchMedia at all, so there's no existing function
  // to spy on — assign the stub directly instead of vi.spyOn.
  window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);
  return {
    fire(matches: boolean) {
      mql.matches = matches;
      for (const cb of listeners) cb({ matches } as MediaQueryListEvent);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Drawer", () => {
  it("renders children in static desktop mode without a backdrop", () => {
    stubMatchMedia(false);
    render(
      <Drawer open={false} onClose={() => {}}>
        <p>sidebar content</p>
      </Drawer>,
    );
    expect(screen.getByText("sidebar content")).toBeInTheDocument();
    // No mobile backdrop when not narrow.
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
  });

  it("shows a backdrop when narrow and open, and closes on backdrop click", () => {
    stubMatchMedia(true);
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <p>sidebar content</p>
      </Drawer>,
    );
    const backdrop = document.querySelector(".fixed.inset-0") as HTMLElement;
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render a backdrop when narrow but closed", () => {
    stubMatchMedia(true);
    render(
      <Drawer open={false} onClose={() => {}}>
        <p>sidebar content</p>
      </Drawer>,
    );
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
  });

  it("shows a resize handle only when resizable and not narrow", () => {
    stubMatchMedia(false);
    const { container, rerender } = render(
      <Drawer open onClose={() => {}} resizable minWidth={100} maxWidth={400}>
        <p>content</p>
      </Drawer>,
    );
    expect(container.querySelector('[title="Drag to resize"]')).toBeInTheDocument();

    rerender(
      <Drawer open onClose={() => {}} resizable={false} minWidth={100} maxWidth={400}>
        <p>content</p>
      </Drawer>,
    );
    expect(container.querySelector('[title="Drag to resize"]')).toBeNull();
  });

  it("restores a persisted width from localStorage when resizable", () => {
    stubMatchMedia(false);
    localStorage.setItem("my-drawer-width", "333");
    const { container } = render(
      <Drawer
        open
        onClose={() => {}}
        resizable
        minWidth={100}
        maxWidth={400}
        storageKey="my-drawer-width"
        desktopMode="sticky"
      >
        <p>content</p>
      </Drawer>,
    );
    const wrapperDiv = container.querySelector('[title="Drag to resize"]')!.parentElement as HTMLElement;
    expect(wrapperDiv.style.width).toBe("333px");
  });

  it("ignores an out-of-range or malformed persisted width and falls back to defaultWidth", () => {
    stubMatchMedia(false);
    localStorage.setItem("bad-width", "not-a-number");
    const { container } = render(
      <Drawer open onClose={() => {}} resizable minWidth={100} maxWidth={400} defaultWidth={250} storageKey="bad-width">
        <p>content</p>
      </Drawer>,
    );
    const wrapperDiv = container.querySelector('[title="Drag to resize"]')!.parentElement as HTMLElement;
    expect(wrapperDiv.style.width).toBe("250px");
  });

  it("uses defaultWidth (ignoring persisted width) while in drawer/narrow mode", () => {
    stubMatchMedia(true);
    localStorage.setItem("w-key", "333");
    const { container } = render(
      <Drawer open onClose={() => {}} resizable minWidth={100} maxWidth={400} defaultWidth={250} storageKey="w-key">
        <p>content</p>
      </Drawer>,
    );
    const drawerDiv = container.querySelector('[style*="translateX"]') as HTMLElement;
    expect(drawerDiv.style.width).toBe("250px");
  });

  it("collapses when the docked chat leaves less than the breakpoint beside it", () => {
    stubMatchMedia(false);
    const prevWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1400 });
    document.body.classList.add("rlc-anchored");
    const shell = document.createElement("div");
    shell.className = "app-shell";
    shell.style.paddingRight = "700px";
    document.body.appendChild(shell);
    try {
      render(
        <Drawer open onClose={() => {}} breakpoint={1050}>
          <p>sidebar content</p>
        </Drawer>,
      );
      // 1400 − 700 = 700, under the 1050 tree breakpoint, even though the
      // viewport media query itself does not match.
      expect(document.querySelector(".fixed.inset-0")).toBeInTheDocument();
    } finally {
      shell.remove();
      document.body.classList.remove("rlc-anchored");
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: prevWidth });
    }
  });

  it("stays in the page when the docked chat still leaves room past the breakpoint", () => {
    stubMatchMedia(false);
    const prevWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1400 });
    document.body.classList.add("rlc-anchored");
    const shell = document.createElement("div");
    shell.className = "app-shell";
    shell.style.paddingRight = "200px";
    document.body.appendChild(shell);
    try {
      render(
        <Drawer open onClose={() => {}} breakpoint={1050}>
          <p>sidebar content</p>
        </Drawer>,
      );
      expect(document.querySelector(".fixed.inset-0")).toBeNull();
    } finally {
      shell.remove();
      document.body.classList.remove("rlc-anchored");
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: prevWidth });
    }
  });

  it("reacts to a matchMedia change event (resize crossing the breakpoint)", () => {
    const mm = stubMatchMedia(false);
    render(
      <Drawer open onClose={() => {}} breakpoint={800}>
        <p>content</p>
      </Drawer>,
    );
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
    act(() => mm.fire(true));
    expect(document.querySelector(".fixed.inset-0")).toBeInTheDocument();
  });
});

describe("DrawerToggle", () => {
  it("renders nothing when not narrow", () => {
    stubMatchMedia(false);
    const { container } = render(<DrawerToggle label="Menu" onClick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a button with the label and fires onClick when narrow", () => {
    stubMatchMedia(true);
    const onClick = vi.fn();
    render(<DrawerToggle label="Tree" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "☰ Tree" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
