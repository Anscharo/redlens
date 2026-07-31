import { test, expect } from "@playwright/test";

// Reader geometry against the real DOM — auto-expand of depth-6 gates, scroll
// into view, and selection. These are invisible to jsdom (no layout/scroll), so
// they belong here. We discover a real gated deep node from the live tree rather
// than hardcoding a UUID (which would rot as atlas content moves).
const READY = 45_000;

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

  test("navigating to a doc nested several levels inside a collapsed branch auto-expands its whole ancestor chain and scrolls to it", async ({ page }) => {
    await page.goto("/atlas");
    await expect(page.locator("article.atlas-node").first()).toBeVisible({ timeout: READY });

    // First paint: every parent row starts collapsed, marked by an
    // "N hidden" affordance. Located by its stable aria-label rather than class.
    const affordance = page.getByRole("button", { name: /hidden sections/ }).first();
    await expect(affordance).toBeVisible({ timeout: READY });

    // The collapsed branch's root is the article that contains the affordance.
    const rootId = await affordance.evaluate((el) => el.closest("article")?.id ?? null);
    expect(rootId).toBeTruthy();

    // The tab reveals the WHOLE branch at once (every level, titles only —
    // see subtreeState.ts / handleExpandParent), so this single click can
    // expose several nested levels in one shot. Find the most deeply nested
    // row it exposed (highest doc-number chiclet count) and an intermediate
    // ancestor strictly between it and root — by DOM order, the nearest
    // preceding row with a shallower chiclet count is its visual parent —
    // so the deep-link below exercises a genuine multi-hop ancestor raise,
    // not just one level.
    await affordance.click();
    const { deepId, midId } = await page.evaluate((rid) => {
      const rows = Array.from(document.querySelectorAll("article.atlas-node"));
      const rootIdx = rows.findIndex((el) => el.id === rid);
      const after = rows.slice(rootIdx + 1).map((el) => ({
        id: el.id,
        depth: el.querySelectorAll(".atlas-chiclet").length,
      }));
      if (!after.length) return { deepId: null, midId: null };
      let deepIdx = 0;
      for (let i = 1; i < after.length; i++) if (after[i].depth > after[deepIdx].depth) deepIdx = i;
      const deep = after[deepIdx];
      let midId: string | null = null;
      for (let i = deepIdx - 1; i >= 0; i--) {
        if (after[i].depth < deep.depth) {
          midId = after[i].id;
          break;
        }
      }
      return { deepId: deep.id, midId };
    }, rootId);
    expect(deepId).toBeTruthy();
    expect(midId).toBeTruthy();

    // Fresh navigation straight to the deep node: BOTH ancestors (the
    // intermediate one and the original collapsed root) must be rendered —
    // a multi-hop ancestor raise — and the node itself selected and
    // scrolled into view.
    await page.goto(`/atlas?id=${deepId}`);
    const deep = page.locator(`article[id="${deepId}"]`);
    await expect(deep).toHaveClass(/is-selected/, { timeout: READY });
    await expect(deep).toBeInViewport();
    await expect(page.locator(`article[id="${midId}"]`)).toHaveCount(1);
    await expect(page.locator(`article[id="${rootId}"]`)).toHaveCount(1);
  });
});
