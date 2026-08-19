import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { callTool } from "./mcp";

// History-tab geometry against the real DOM. The timeline is built from
// absolutely-positioned rail segments whose offsets are derived constants
// (Timeline.tsx: LINE1_H, NODE_TOP, the 1px bleed) — jsdom has no layout, so
// only a browser can prove the dot actually lands on the date and the line
// actually runs unbroken. Content assertions live in the vitest specs.
const READY = 45_000;

type RecentPayload = {
  events: Array<{ doc_id: string }>;
} & Record<string, unknown>;
type HistoryPayload = {
  events: Array<{ diff?: unknown }>;
} & Record<string, unknown>;

let historyDocId = "";
let diffDocId = "";

async function discoverCanaryDocs(request: APIRequestContext): Promise<void> {
  const recent = await callTool<RecentPayload>(request, "atlas_recent_changes", {
    since: "2023-01-01",
    k: 100,
  });
  expect(
    recent.events.length,
    "history canary requires a populated atlas_history table; run the Atlas worker first",
  ).toBeGreaterThan(0);

  const ids = [...new Set(recent.events.map((event) => event.doc_id).filter(Boolean))];
  historyDocId = ids[0] ?? "";
  for (const id of ids.slice(0, 20)) {
    const history = await callTool<HistoryPayload>(request, "atlas_history", { id, with_diff: true });
    if (history.events.some((event) => event.diff)) {
      diffDocId = id;
      break;
    }
  }
  expect(historyDocId, "history canary could not derive a document from recent changes").toBeTruthy();
  expect(diffDocId, "history canary found no recent document with a stored line diff").toBeTruthy();
}

async function openHistory(page: Page, id: string) {
  await page.goto(`/atlas?id=${id}`, { waitUntil: "domcontentloaded" });
  const panel = page.getByTestId("history-panel");
  await expect(panel.locator("[data-timeline-rail]").first()).toBeVisible({ timeout: READY });
  return panel;
}

/** Measure every timeline row: its rail box, its node dot, and its first line. */
async function rows(panel: Locator) {
  return panel.evaluate((root) => {
    const rails = [...root.querySelectorAll("[data-timeline-rail]")];
    return rails.map((rail) => {
      const r = rail.getBoundingClientRect();
      const dotEl = rail.querySelector("[data-timeline-dot]");
      const dot = dotEl?.getBoundingClientRect();
      const line1 = rail.nextElementSibling?.firstElementChild?.getBoundingClientRect();
      const verticals = [...rail.querySelectorAll("[data-timeline-segment='vertical']")].map((segment) =>
        segment.getBoundingClientRect(),
      );
      return {
        top: r.top,
        bottom: r.bottom,
        dotCenter: dot ? dot.top + dot.height / 2 : null,
        lineCenter: line1 ? line1.top + line1.height / 2 : null,
        railTop: verticals.length ? Math.min(...verticals.map((v) => v.top)) : null,
        railBottom: verticals.length ? Math.max(...verticals.map((v) => v.bottom)) : null,
      };
    });
  });
}

test.describe("history timeline", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ request }) => discoverCanaryDocs(request));

  test("every node dot is centered on its entry's date line", async ({ page }) => {
    const panel = await openHistory(page, historyDocId);
    const measured = await rows(panel);
    const dotted = measured.filter((r) => r.dotCenter !== null && r.lineCenter !== null);
    expect(dotted.length).toBeGreaterThan(0);
    for (const r of dotted) {
      // Sub-pixel rounding is fine; a drifted constant is not.
      expect(Math.abs(r.dotCenter! - r.lineCenter!)).toBeLessThanOrEqual(1.5);
    }
  });

  test("the rail runs unbroken from one row to the next", async ({ page }) => {
    const panel = await openHistory(page, historyDocId);

    // Reveal the reconstructed block too — that's where the disclaimers and the
    // toggle interleave with entries, the case most likely to break the line.
    const toggle = page.getByRole("button", { name: /Reconstructed History/i });
    if (await toggle.count()) {
      await toggle.first().click();
      await expect(page.getByRole("button", { name: /Hide Reconstructed History/i })).toBeVisible();
    }

    const measured = (await rows(panel)).filter((r) => r.railTop !== null);
    expect(measured.length).toBeGreaterThan(1);
    for (let i = 0; i < measured.length - 1; i++) {
      // The next row's line must start at (or above) where this one ended.
      expect(measured[i + 1].railTop!).toBeLessThanOrEqual(measured[i].railBottom! + 0.5);
    }
  });

  test("a diff's change markers sit in a gutter beside the line, never inside it", async ({ page }) => {
    const panel = await openHistory(page, diffDocId);
    // Reconstructed entries are where most stored diffs live; reveal them too.
    const toggle = page.getByRole("button", { name: /View Reconstructed History/i });
    if (await toggle.count()) {
      await toggle.first().click();
      await expect(page.getByRole("button", { name: /Hide Reconstructed History/i })).toBeVisible();
    }
    const box = panel.locator(".overflow-x-auto").first();
    await expect(box).toBeVisible({ timeout: READY });

    const geom = await box.evaluate((el) => {
      const marker = el.querySelector("span.select-none");
      const body = marker?.nextElementSibling;
      if (!marker || !body) return null;
      const m = marker.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      return { markerRight: m.right, bodyLeft: b.left, markerWidth: m.width };
    });
    expect(geom).not.toBeNull();
    expect(geom!.markerWidth).toBeCloseTo(20, 0);
    expect(geom!.markerRight).toBeLessThanOrEqual(geom!.bodyLeft + 0.5);
  });
});
