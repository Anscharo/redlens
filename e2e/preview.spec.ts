import { test, expect } from "@playwright/test";
import { currentHeadSha, discoverCanary, pinnedCanary, type CanaryTarget } from "./preview-canary";

// Atlas-preview redline canary against a REAL upstream PR. Two ways to target:
//   pinned    — ATLAS_PREVIEW_CANARY_PR + ATLAS_PREVIEW_CANARY_SHA (dispatch
//               runs): exact, skips if the PR moved or closed.
//   discovery — PREVIEW_CANARY_DISCOVER=1 (scheduled runs): picks the newest
//               eligible open canonical PR at runtime, so cron needs no pins.
// Both skip cleanly when no target is runnable; scheduled skips are counted by
// e2e/check-canary-skips.mjs so silence can't last forever. Candidate selection
// and the expected-diff derivation live in e2e/preview-canary.ts.

const BUILD_TIMEOUT = 150_000; // first preview build clones + builds the atlas

test("previews an atlas PR canary and redlines exactly the docs it changed", async ({ page }) => {
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
  const { number, headSha, expectedIds } = resolved as CanaryTarget;
  console.log(`preview canary: atlas PR #${number} at ${headSha} (${expectedIds.length} expected docs)`);

  // Capture the preview bundle's diff.json (fetched once the build is ready).
  const diffResponse = page.waitForResponse(
    (r) => /\/api\/preview\/[0-9a-f]+\/diff\.json$/.test(r.url()) && r.status() === 200,
    { timeout: BUILD_TIMEOUT },
  );
  await page.goto(`/preview/pull-${number}`, { waitUntil: "domcontentloaded" });
  const diff = (await (await diffResponse).json()) as {
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

  // Every doc the PR added/changed must appear in our computed diff.
  const missing = expectedIds.filter((id) => !marked.has(id));
  expect(missing, `PR #${number} at ${headSha}: these changed docs were missing from the preview diff`).toEqual([]);

  // And the render path actually marks one of them in the reader.
  await page.goto(`/preview/pull-${number}/atlas?id=${expectedIds[0]}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[aria-label$="in this preview"]').first()).toBeVisible({ timeout: 60_000 });
});
