// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { FeaturesPage } from "./FeaturesPage";
import { FEATURE_GROUPS } from "@/lib/featuresData";
import { ROUTES, REPORT_TITLES } from "@/lib/routes";

afterEach(cleanup);

function wrap(path = ROUTES.FEATURES) {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("FeaturesPage", () => {
  it("renders every group heading and every feature name", () => {
    render(<FeaturesPage />, { wrapper: wrap() });
    expect(screen.getByRole("heading", { level: 1, name: "Everything you can do" })).toBeInTheDocument();
    for (const g of FEATURE_GROUPS) {
      expect(screen.getByRole("heading", { level: 2, name: g.title })).toBeInTheDocument();
      for (const f of g.features) expect(screen.getByText(f.name)).toBeInTheDocument();
    }
  });

  it("gives every group a hash anchor whose heading links to it", () => {
    const { container } = render(<FeaturesPage />, { wrapper: wrap() });
    for (const g of FEATURE_GROUPS) {
      const section = container.querySelector(`section#${g.key}`);
      expect(section, g.key).not.toBeNull();
      // Without scroll-margin the deep-linked heading lands under the sticky header.
      expect(section).toHaveStyle({ scrollMarginTop: "64px" });
      const link = screen.getByRole("link", { name: g.title });
      expect(link).toHaveAttribute("href", `#${g.key}`);
    }
  });

  it("links each group that names a destination to that destination", () => {
    render(<FeaturesPage />, { wrapper: wrap() });
    for (const g of FEATURE_GROUPS) {
      const to = g.href ?? g.route;
      if (to) expect(screen.getByRole("link", { name: to })).toHaveAttribute("href", to);
    }
  });
});

describe("featuresData", () => {
  // A `route` is rendered as a wouter <Link>, so a value App.tsx has no <Route>
  // for navigates the SPA to a blank page instead of loading anything. Anything
  // outside the router (preview mounts its own shell) belongs in `href`.
  it("points every in-SPA group route at a real app route", () => {
    const known = new Set<string>(Object.values(ROUTES));
    for (const g of FEATURE_GROUPS) {
      if (g.route) expect(known, `${g.title} → ${g.route}`).toContain(g.route);
      expect(g.route && g.href, `${g.title} sets both route and href`).toBeFalsy();
    }
  });

  it("gives every feature a name, a what, and at least one how step", () => {
    for (const g of FEATURE_GROUPS) {
      expect(g.features.length, g.title).toBeGreaterThan(0);
      for (const f of g.features) {
        expect(f.name.length, `${g.title}/${f.name}`).toBeGreaterThan(0);
        expect(f.what.length, `${g.title}/${f.name}`).toBeGreaterThan(0);
        expect(f.how.length, `${g.title}/${f.name}`).toBeGreaterThan(0);
      }
    }
  });

  // Keys are the public /features#<key> anchors, so they have to survive a URL
  // round-trip: no spaces, no uppercase, nothing needing percent-encoding.
  it("uses keys that are valid, stable URL fragments", () => {
    for (const g of FEATURE_GROUPS) {
      expect(g.key, g.title).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(encodeURIComponent(g.key), g.title).toBe(g.key);
    }
  });

  it("uses unique keys and unique feature names (the render keys off both)", () => {
    const keys = FEATURE_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of FEATURE_GROUPS) {
      const names = g.features.map((f) => f.name);
      expect(new Set(names).size, g.title).toBe(names.length);
      for (const f of g.features) expect(new Set(f.how).size, f.name).toBe(f.how.length);
    }
  });

  // The guide shipped saying "Eight purpose-built reports" the same week two
  // more landed. Any spelled-out or digit count of a set the app derives
  // elsewhere is stale by construction — describe the set, don't count it.
  it("hardcodes no report or tool counts", () => {
    const prose = FEATURE_GROUPS.flatMap((g) => [
      g.blurb,
      ...g.features.flatMap((f) => [f.what, ...f.how, f.note ?? ""]),
    ]).join("\n");
    expect(prose).not.toMatch(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(purpose-built\s+)?(reports?|tools?)\b/i,
    );
  });

  // Report names in the copy have to be the names on the report cards, or the
  // instruction "open X" sends the reader looking for something that isn't there.
  it("names reports by their real titles", () => {
    const prose = FEATURE_GROUPS.find((g) => g.key === "reports")!;
    const text = [prose.blurb, ...prose.features.flatMap((f) => [f.what, ...f.how])].join("\n");
    for (const title of ["OEA Task Assessment", "Risk Rules"]) {
      expect(text, title).toContain(title);
    }
    // …and nothing invented: every REPORT_TITLES entry is a legal mention, but a
    // near-miss like "OEA Assessment" (the old wording) must not survive.
    expect(text).not.toContain("OEA Assessment;");
    expect(Object.values(REPORT_TITLES)).toContain("OEA Task Assessment");
  });

  it("lists Chat as a current capability, not a planned one", () => {
    expect(FEATURE_GROUPS.some((g) => g.key === "upcoming")).toBe(false);
    const chat = FEATURE_GROUPS.find((g) => g.key === "chat");
    expect(chat, "chat group").toBeTruthy();
    const prose = [
      chat!.title,
      chat!.blurb,
      ...chat!.features.flatMap((f) => [f.name, f.what, ...f.how, f.note ?? ""]),
    ].join("\n");
    expect(prose).not.toMatch(/upcoming|not yet|will require|planned features/i);
  });
});
