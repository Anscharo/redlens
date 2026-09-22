import { test, expect, type Page } from "@playwright/test";
import {
  currentHeadSha,
  discoverCanary,
  isPreviewDiffResponse,
  pinnedCanary,
  type CanaryTarget,
} from "./preview-canary";

// Atlas-preview redline canary against a REAL upstream PR. Two ways to target:
//   pinned    — ATLAS_PREVIEW_CANARY_PR + ATLAS_PREVIEW_CANARY_SHA (dispatch
//               runs): exact, skips if the PR moved or closed.
//   discovery — PREVIEW_CANARY_DISCOVER=1 (scheduled runs): picks the newest
//               eligible open PR (fork heads included) at runtime, so cron
//               needs no pins.
// Both skip cleanly when no target is runnable; scheduled skips are counted by
// e2e/check-canary-skips.mjs so silence can't last forever. Candidate selection
// and the expected-diff derivation live in e2e/preview-canary.ts.

// Server default is PREVIEW_BUILD_TIMEOUT_MS (5 min). Wait a little longer so
// a kill at the server cap still surfaces as a non-200 rather than this wait
// timing out with no response at all.
const BUILD_TIMEOUT = 330_000;

/** Non-trusted fork previews gate <App/> — and therefore the diff.json fetch —
 *  behind a click-through interstitial (PreviewGate.tsx). Poll for its button
 *  while the awaited response is pending and click through once. */
async function awaitDismissingInterstitial<T>(page: Page, pending: Promise<T>): Promise<T> {
  const ack = page.getByRole("button", { name: /view the fork/i });
  let settled = false;
  const tracked = pending.finally(() => {
    settled = true;
  });
  void (async () => {
    while (!settled) {
      if (await ack.isVisible().catch(() => false)) {
        await ack.click().catch(() => {});
        return;
      }
      await page.waitForTimeout(1_000).catch(() => {});
    }
  })();
  return tracked;
}

test("previews an atlas PR canary and redlines the docs it changed", async ({ page }) => {
  test.setTimeout(BUILD_TIMEOUT + 60_000);

  const pinnedPr = Number(process.env.ATLAS_PREVIEW_CANARY_PR ?? "");
  const pinnedSha = process.env.ATLAS_PREVIEW_CANARY_SHA;
  const discover = process.env.PREVIEW_CANARY_DISCOVER === "1";
  test.skip(
    !(pinnedPr && pinnedSha) && !discover,
    "set ATLAS_PREVIEW_CANARY_PR + ATLAS_PREVIEW_CANARY_SHA, or PREVIEW_CANARY_DISCOVER=1, to run the preview canary",
  );

  const resolved =
    pinnedPr && pinnedSha ? await pinnedCanary(fetch, pinnedPr, pinnedSha) : await discoverCanary(fetch);
  test.skip(!("headSha" in resolved), (resolved as { reason?: string }).reason ?? "no runnable preview canary");
  const { number, headSha, headRepo, expectedIds } = resolved as CanaryTarget;
  console.log(
    `preview canary: atlas PR #${number} at ${headSha} from ${headRepo} (${expectedIds.length} expected docs)`,
  );

  // Capture the preview-diff fetch (plain diff.json, or diff.sky.json /
  // diff.repo.json — PreviewDiffProvider prefers the keyed auto pair).
  // isPreviewDiffResponse ignores a non-200 keyed file (client falls back
  // to plain) and matches any status on the settled URL so a 5xx fails
  // immediately instead of waiting out BUILD_TIMEOUT.
  const diffResponse = page.waitForResponse(isPreviewDiffResponse, { timeout: BUILD_TIMEOUT });
  await page.goto(`/preview/pull-${number}`, { waitUntil: "domcontentloaded" });
  const response = await awaitDismissingInterstitial(page, diffResponse);
  expect(response.status(), `preview diff HTTP ${response.status()} ${response.url()}`).toBe(200);
  const diff = (await response.json()) as {
    added?: string[];
    changed?: string[];
    renumbered?: Record<string, unknown>;
  };

  // Discovery pins nothing upstream: if the PR gained commits while the
  // preview built, the served diff is for a different head — skip, don't lie.
  const headAfterBuild = await currentHeadSha(fetch, number);
  test.skip(headAfterBuild !== headSha, `atlas PR #${number} moved during preview build`);

  const marked = new Set<string>([
    ...(diff.added ?? []),
    ...(diff.changed ?? []),
    ...Object.keys(diff.renumbered ?? {}),
  ]);

  // Every doc the PR added/changed must appear in our computed diff. (Subset
  // check by design: the preview may legitimately mark more — e.g. renumber
  // cascades — than the per-file expectation derives.)
  const missing = expectedIds.filter((id) => !marked.has(id));
  expect(missing, `PR #${number} at ${headSha}: these changed docs were missing from the preview diff`).toEqual([]);

  // And the render path actually marks one of them in the reader. (The
  // interstitial was acknowledged for this session above, so no second gate.)
  await page.goto(`/preview/pull-${number}/atlas?id=${expectedIds[0]}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label$="in this preview"]').first()).toBeVisible({ timeout: 60_000 });
});
