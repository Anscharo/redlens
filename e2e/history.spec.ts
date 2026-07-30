import { test, expect, type Page } from "@playwright/test";
import { readiness } from "./health";

// History-tab geometry against the real DOM. The timeline is built from
// absolutely-positioned rail segments whose offsets are derived constants
// (Timeline.tsx: LINE1_H, NODE_TOP, the 1px bleed) — jsdom has no layout, so
// only a browser can prove the dot actually lands on the date and the line
// actually runs unbroken. Content assertions live in the vitest specs.
//
// These specs measure geometry, so they need a doc that HAS history entries.
// Whether the deploy's Postgres carries any is a property of the environment,
// not of the layout: a PR environment's DB is forked cold and synced after the
// container reports healthy. So they skip on "no entries" (with the reason) —
// the missing DB is reported once, by the "reachable DB" check in smoke.spec.
const READY = 45_000;

async function firstNodeIds(page: Page, count = 1): Promise<string[]> {
  await page.goto("/atlas");
  await expect(page.locator("article.atlas-node").first()).toBeVisible({ timeout: READY });
  const ids = await page
    .locator("article.atlas-node")
    .evaluateAll((els) => els.map((e) => e.id).filter(Boolean));
  expect(ids.length, "the reader rendered no identified nodes").toBeGreaterThan(0);
  return ids.slice(0, count);
}

function panel(page: Page) {
  return page.getByTestId("history-panel");
}

/**
 * Open a doc's History tab (the default right-panel tab) and wait for the async
 * load to SETTLE — not for an entry to appear. Waiting on "an article showed up"
 * hangs for the full timeout whenever the deploy has no history for the doc,
 * which is the difference between a 1s skip and a 45s timeout per test.
 *
 * Returns how many entries rendered.
 */
async function openHistory(page: Page, id: string): Promise<number> {
  await page.goto(`/atlas?id=${id}`);
  const p = panel(page);
  await expect(p).toBeVisible({ timeout: READY });
  // NodeHistory renders exactly one of: "loading history…", "no history
  // recorded", or a list of <article> entries.
  await expect(p.getByText("loading history…")).toHaveCount(0, { timeout: READY });
  return p.locator("article").count();
}

/** Reveal the reconstructed block — where the disclaimers and the toggle
 *  interleave with entries, the case most likely to break the line. */
async function revealReconstructed(page: Page) {
  const toggle = page.getByRole("button", { name: /View Reconstructed History/i });
  if (await toggle.count()) {
    await toggle.first().click();
    await expect(page.getByRole("button", { name: /Hide Reconstructed History/i })).toBeVisible();
  }
}

function noEntries(id: string): string {
  return `deploy has no history entries for ${id}: ${readiness().detail}`;
}

/** Measure every timeline row: its rail box, its node dot, and its first line. */
async function rows(page: Page) {
  return panel(page).evaluate((root) => {
    // Scoped to the history panel and keyed on the rail's own attribute, so an
    // unrelated decoration of the same width elsewhere can't join the sample.
    const rails = [...root.querySelectorAll("[data-timeline-rail]")];
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
    const [id] = await firstNodeIds(page);
    test.skip((await openHistory(page, id)) === 0, noEntries(id));

    const measured = await rows(page);
    const dotted = measured.filter((r) => r.dotCenter !== null && r.lineCenter !== null);
    expect(dotted.length).toBeGreaterThan(0);
    for (const r of dotted) {
      // Sub-pixel rounding is fine; a drifted constant is not.
      expect(Math.abs(r.dotCenter! - r.lineCenter!)).toBeLessThanOrEqual(1.5);
    }
  });

  test("the rail runs unbroken from one row to the next", async ({ page }) => {
    const [id] = await firstNodeIds(page);
    test.skip((await openHistory(page, id)) === 0, noEntries(id));
    await revealReconstructed(page);

    const measured = (await rows(page)).filter((r) => r.railTop !== null);
    test.skip(measured.length < 2, `only ${measured.length} timeline row(s) rendered for ${id}`);
    for (let i = 0; i < measured.length - 1; i++) {
      // The next row's line must start at (or above) where this one ended.
      expect(measured[i + 1].railTop!).toBeLessThanOrEqual(measured[i].railBottom! + 0.5);
    }
  });

  test("a diff's change markers sit in a gutter beside the line, never inside it", async ({ page }) => {
    // Only edits carry a stored diff, so walk the first handful of docs until one
    // has one rather than betting on whichever node happens to be first.
    const ids = await firstNodeIds(page, 10);
    const box = panel(page).locator("article .overflow-x-auto").first();
    let found = false;
    let empty = 0;
    for (const id of ids) {
      if ((await openHistory(page, id)) === 0) {
        // A deploy either has synced atlas history or it hasn't. Two empty docs
        // in a row settle it — walking the remaining eight only spends a page
        // load each to reach the same conclusion.
        if (++empty >= 2) break;
        continue;
      }
      empty = 0;
      // Reconstructed entries are where most stored diffs live; reveal them too.
      await revealReconstructed(page);
      if (await box.count()) {
        found = true;
        break;
      }
    }
    test.skip(!found, `none of the first ${ids.length} docs' histories carry a line diff: ${readiness().detail}`);

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
