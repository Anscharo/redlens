// Browser-side loader for oea-report.json.
//
// Split out of oeaReport.ts so that file stays pure: the OEA report is BUILT by
// scripts/required/build-oea-report.ts, which runs in the atlas worker image and
// only wants createOeaReport. Keeping the fetch path in the same module put
// atlasBase -> analytics -> posthog-js (a browser SDK) on the worker's runtime
// import graph, which the worker image then had to install. See
// scripts/required/check-boundaries.mjs, which fails the build if that edge
// comes back.
import { fetchJson } from "@/lib/verify";
import { handledStale, liveAtlasBase } from "./atlasBase";
import type { OeaReportArtifact } from "@/lib/oeaReport";

const cache = new Map<string, Promise<OeaReportArtifact>>();

export function loadOeaReport(base: string = liveAtlasBase()): Promise<OeaReportArtifact> {
  let cached = cache.get(base);
  if (!cached) {
    cached = fetchJson<OeaReportArtifact>(
      `${base}oea-report.json`,
      "oea-report.json",
    ).catch((err) => {
      cache.delete(base);
      if (handledStale(err)) return new Promise<OeaReportArtifact>(() => {});
      throw err;
    });
    cache.set(base, cached);
  }
  return cached;
}
