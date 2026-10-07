// The Markdown the pau-triage skill reads. Pinned: every row cites its atlas
// doc as `doc_no (uuid)` (or says the doc was removed), shared contracts are
// labelled as such, empty sections say so instead of vanishing, registry
// errors appear only when there are any, and a run without --rpc says how to
// get the wiring section.

import { describe, expect, it } from "vitest";
import { renderCandidates, type CandidatesResult } from "../scripts/lib/pau-report.ts";
import type { AtlasNode } from "../src/types.ts";

const PRIME = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";
const A = "0x" + "a".repeat(40);
const docs = { [DOC]: { id: DOC, doc_no: "A.6.1.1.2", title: "ALM Controller Contract" } as AtlasNode };
const names = new Map([[PRIME, "Grove"]]);

const base: CandidatesResult = {
  atlasCommit: "33fd263",
  registryErrors: [],
  observations: 3,
  missing: [
    { prime: PRIME, chain: "base", chainFrom: "title", kind: "monolithic", role: "controller", address: A, doc: DOC, docNo: "A.6.1.1.2", title: "ALM Controller Contract" },
    { prime: null, chain: "ethereum", chainFrom: "address", kind: "diamond", role: "facet", address: A, doc: DOC, docNo: "A.6.1.1.2", title: "USDS Facet" },
  ],
  stale: [{ prime: PRIME, chain: "base", role: "rateLimits", address: A, doc: GONE, reason: "doc-removed" }],
  conflicts: [{ address: A, reason: "roles", detail: "controller@base, rateLimits@plume", docs: [DOC, GONE] }],
  wiring: null,
};

describe("renderCandidates", () => {
  it("cites every row's doc and names the prime or the shared set", () => {
    const md = renderCandidates(base, docs, names);
    expect(md).toContain("Atlas commit `33fd263`. 3 PAU addresses observed in the atlas; 2 missing, 1 stale, 1 conflicts.");
    expect(md).toContain(`| Grove | base | monolithic | controller | \`${A}\` | ALM Controller Contract | A.6.1.1.2 (${DOC}) |`);
    expect(md).toContain(`| shared | ethereum | diamond | facet |`);
    expect(md).toContain(`| doc-removed | (removed ${GONE}) |`);
    expect(md).toContain(`A.6.1.1.2 (${DOC})<br>(removed ${GONE})`);
  });
  it("omits registry errors when there are none and asks for --rpc when wiring did not run", () => {
    const md = renderCandidates(base, docs, names);
    expect(md).not.toContain("## Registry errors");
    expect(md).toContain("_Not run. Pass `--rpc` to read the contracts._");
  });
  it("renders registry errors, empty sections, failed checks and proposals", () => {
    const md = renderCandidates(
      {
        ...base,
        registryErrors: ["deployments[0]: unknown kind"],
        missing: [],
        wiring: {
          checks: [
            { deployment: "d", check: "proxy", ok: true, detail: "ok" },
            { deployment: "d", check: "live controller", ok: false, detail: "not granted" },
          ],
          proposals: [{ deployment: "d", chain: "base", role: "controller", address: A, note: "holds CONTROLLER" }],
        },
      },
      docs,
      names,
    );
    expect(md).toContain("## Registry errors\n\n- deployments[0]: unknown kind");
    expect(md).toContain("## Missing from the registry\n\n_None._");
    expect(md).toContain("1 of 2 checks pass.");
    expect(md).toContain("| d | live controller | not granted |");
    expect(md).toContain(`| d | controller | \`${A}\` | holds CONTROLLER |`);
  });
});
