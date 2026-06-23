import { test, expect } from "@playwright/test";

// Reader geometry against the real DOM — auto-expand of depth-6 gates, scroll
// into view, and selection. These are invisible to jsdom (no layout/scroll), so
// they belong here. We discover a real gated deep node from the live tree rather
// than hardcoding a UUID (which would rot as atlas content moves).
const READY = 30_000;

test.describe("reader navigation", () => {
  test("selecting a node via URL marks it selected and shows it", async ({ page }) => {
    await page.goto("/atlas");
    const firstArticle = page.locator("article.atlas-node").first();
    await expect(firstArticle).toBeVisible({ timeout: READY });

    const id = await firstArticle.getAttribute("id");
    expect(id).toBeTruthy();

    await page.goto(`/atlas?id=${id}`);
    const selected = page.locator(`article[id="${id}"]`);
    await expect(selected).toHaveClass(/is-selected/, { timeout: READY });
    await expect(selected).toBeInViewport();
  });

  test("navigating to a gated depth-6 node auto-expands its ancestor and scrolls to it", async ({ page }) => {
    await page.goto("/atlas");
    await expect(page.locator("article.atlas-node").first()).toBeVisible({ timeout: READY });

    // A "N hidden" affordance marks a node that gates depth-6+ descendants.
    const affordance = page.locator(".view-children-affordance").first();
    await expect(affordance).toBeVisible({ timeout: READY });

    // The gating ancestor is the article that contains the affordance.
    const gatingId = await affordance.evaluate((el) => el.closest("article")?.id ?? null);
    expect(gatingId).toBeTruthy();

    // Reveal the gated children, then find an article that appeared as a result.
    const before = await page.locator("article.atlas-node").evaluateAll((els) => els.map((e) => e.id));
    await affordance.click();
    await expect
      .poll(async () => (await page.locator("article.atlas-node").evaluateAll((els) => els.length)))
      .toBeGreaterThan(before.length);

    const deepId = await page.locator("article.atlas-node").evaluateAll(
      (els, prev) => els.map((e) => e.id).find((id) => id && !prev.includes(id)) ?? null,
      before,
    );
    expect(deepId).toBeTruthy();

    // Fresh navigation to the deep node: its gating ancestor must be rendered
    // (auto-expanded), and the node itself selected and scrolled into view.
    await page.goto(`/atlas?id=${deepId}`);
    const deep = page.locator(`article[id="${deepId}"]`);
    await expect(deep).toHaveClass(/is-selected/, { timeout: READY });
    await expect(deep).toBeInViewport();
    await expect(page.locator(`article[id="${gatingId}"]`)).toHaveCount(1);
  });
});
