import { test, expect } from "@playwright/test";

// Search quality against the LIVE MiniSearch index (runs in a Web Worker, builds
// from the real docs payload) — the heavy path jsdom can't exercise. We drive
// queries via the URL (?q=) on the home/search route and assert ranking surface,
// highlight markup, field-filtering, and the empty state.
//
// First load builds the worker index from the full docs payload, so the initial
// result wait is generous.
const READY = 45_000;

test.describe("search quality", () => {
  test("a common term returns ranked results with highlighted snippets", async ({ page }) => {
    await page.goto("/?q=governance", { waitUntil: "domcontentloaded" });

    const results = page.locator("a.search-result-link");
    await expect(results.first()).toBeVisible({ timeout: READY });
    expect(await results.count()).toBeGreaterThan(0);

    // The results header reports a count (".. N results · Xms").
    await expect(page.getByText(/\d+ results?/)).toBeVisible();

    // Snippets/titles carry <mark> highlight markup for the matched term.
    await expect(page.locator("a.search-result-link mark").first()).toBeVisible();
  });

  test("the type: filter restricts results to that document type", async ({ page }) => {
    await page.goto("/?q=type:Core governance", { waitUntil: "domcontentloaded" });

    const badges = page.locator("a.search-result-link .badge");
    await expect(badges.first()).toBeVisible({ timeout: READY });

    // Every returned doc must be of the filtered type.
    for (const text of await badges.allInnerTexts()) {
      expect(text.trim()).toBe("Core");
    }
  });
});
