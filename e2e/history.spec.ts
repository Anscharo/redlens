import { test, expect } from "@playwright/test";

// History-tab geometry against the real DOM. The timeline is built from
// absolutely-positioned rail segments whose offsets are derived constants
// (Timeline.tsx: LINE1_H, NODE_TOP, the 1px bleed) — jsdom has no layout, so
// only a browser can prove the dot actually lands on the date and the line
// actually runs unbroken. Content assertions live in the vitest specs.
const READY = 45_000;

/** Measure every timeline row: its rail box, its node dot, and its first line. */
async function rows(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    // Reader articles carry .atlas-node; history entries and the connective rows
    // (disclaimers, toggle) are the other rails in the panel.
    const rails = [...document.querySelectorAll("[aria-hidden='true']")].filter(
      (el) => Math.round(el.getBoundingClientRect().width) === 18 && el.getBoundingClientRect().height > 4,
    );
    return rails.map((rail) => {
      const r = rail.getBoundingClientRect();
      const dotEl = rail.querySelector("span.rounded-full");
      const dot = dotEl?.getBoundingClientRect();
      const line1 = rail.nextElementSibling?.firstElementChild?.getBoundingClientRect();
      const verticals = [...rail.querySelectorAll("span:not(.rounded-full)")]
        .map((s) => s.getBoundingClientRect())
        .filter((b) => b.width <= 2);
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
  test("every node dot is centered on its entry's date line", async ({ page }) => {
    await page.goto("/atlas");
    const first = page.locator("article.atlas-node").first();
    await expect(first).toBeVisible({ timeout: READY });
    const id = await first.getAttribute("id");

    // History is the default right-panel tab, so selecting the node is enough.
    await page.goto(`/atlas?id=${id}`);
    await expect(page.locator("article:not(.atlas-node)").first()).toBeVisible({ timeout: READY });

    const measured = await rows(page);
    const dotted = measured.filter((r) => r.dotCenter !== null && r.lineCenter !== null);
    expect(dotted.length).toBeGreaterThan(0);
    for (const r of dotted) {
      // Sub-pixel rounding is fine; a drifted constant is not.
      expect(Math.abs(r.dotCenter! - r.lineCenter!)).toBeLessThanOrEqual(1.5);
    }
  });

  test("the rail runs unbroken from one row to the next", async ({ page }) => {
    await page.goto("/atlas");
    const first = page.locator("article.atlas-node").first();
    await expect(first).toBeVisible({ timeout: READY });
    const id = await first.getAttribute("id");

    await page.goto(`/atlas?id=${id}`);
    await expect(page.locator("article:not(.atlas-node)").first()).toBeVisible({ timeout: READY });

    // Reveal the reconstructed block too — that's where the disclaimers and the
    // toggle interleave with entries, the case most likely to break the line.
    const toggle = page.getByRole("button", { name: /Reconstructed History/i });
    if (await toggle.count()) {
      await toggle.first().click();
      await expect(page.getByRole("button", { name: /Hide Reconstructed History/i })).toBeVisible();
    }

    const measured = (await rows(page)).filter((r) => r.railTop !== null);
    expect(measured.length).toBeGreaterThan(1);
    for (let i = 0; i < measured.length - 1; i++) {
      // The next row's line must start at (or above) where this one ended.
      expect(measured[i + 1].railTop!).toBeLessThanOrEqual(measured[i].railBottom! + 0.5);
    }
  });

  test("a diff's change markers sit in a gutter beside the line, never inside it", async ({ page }) => {
    await page.goto("/atlas");
    await expect(page.locator("article.atlas-node").first()).toBeVisible({ timeout: READY });

    // Only edits carry a stored diff, so walk the first handful of docs until one
    // has one rather than betting on whichever node happens to be first.
    const ids = (await page.locator("article.atlas-node").evaluateAll((els) => els.map((e) => e.id))).slice(0, 10);
    const box = page.locator("article:not(.atlas-node) .overflow-x-auto").first();
    let found = false;
    for (const id of ids) {
      await page.goto(`/atlas?id=${id}`);
      await expect(page.locator("article:not(.atlas-node)").first()).toBeVisible({ timeout: READY });
      // Reconstructed entries are where most stored diffs live; reveal them too.
      const toggle = page.getByRole("button", { name: /View Reconstructed History/i });
      if (await toggle.count()) {
        await toggle.first().click();
        await expect(page.getByRole("button", { name: /Hide Reconstructed History/i })).toBeVisible();
      }
      if (await box.count()) {
        found = true;
        break;
      }
    }
    test.skip(!found, "none of the first docs' histories carry a line diff");

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
