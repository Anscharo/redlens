import { describe, it, expect } from "vitest";
import { baseLine, baseSwitch, broadGrantCopy, diffBaseLabel, pullsPermissionCopy, CANONICAL_MAIN, type PreviewMeta, type PreviewBases } from "./previewMetaCopy";

function meta(bases?: PreviewBases, extra: Partial<PreviewMeta> = {}): PreviewMeta {
  return { sha: "x", repo: "r", ref: "b", kind: "branch", ...extra, bases };
}

describe("baseLine", () => {
  it("old bundle without forkOwner renders nothing", () => {
    expect(baseLine(meta(undefined), null)).toBe("");
  });

  it("old bundle fork up to date", () => {
    expect(baseLine(meta(undefined, { forkOwner: "m", aheadBy: 0, behindBy: 0 }), null)).toBe(
      `up to date with ${CANONICAL_MAIN}`,
    );
  });

  it("old bundle fork behind main matches today's non-singularized copy", () => {
    expect(baseLine(meta(undefined, { forkOwner: "m", behindBy: 3 }), null)).toBe("3 commits behind main");
    expect(baseLine(meta(undefined, { forkOwner: "m", behindBy: 1 }), null)).toBe("1 commits behind main");
  });

  it("sky key: up to date", () => {
    const m = meta({
      auto: "sky",
      sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x", aheadBy: 0, behindBy: 0 },
    });
    expect(baseLine(m, { key: "sky", auto: true })).toBe(`up to date with ${CANONICAL_MAIN}`);
  });

  it("sky key: behind main, shown even for a private branch with no forkOwner", () => {
    const m = meta({ auto: "sky", sky: { repo: "acme/fork", ref: "feature", mergeBase: "x", behindBy: 5 } });
    expect(baseLine(m, { key: "sky", auto: true })).toBe("5 commits behind main");
  });

  it("repo key: line + drift segments, omitting undefined numbers", () => {
    const m = meta({
      auto: "repo",
      repo: {
        repo: "acme/fork",
        ref: "main",
        mergeBase: "x",
        drift: { sha: "s", commitsAhead: 4, vsAtlasCommit: "v" },
      },
    });
    expect(baseLine(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe(
      `redlined against acme/fork:main · base forked from ${CANONICAL_MAIN} 4 commits ago`,
    );
  });

  it("repo key: a stale fork main with no unique commits omits the '0 commits ago' segment", () => {
    const meta = {
      bases: {
        auto: "repo" as const,
        repo: { repo: "acme/fork", ref: "main", mergeBase: "x", drift: { sha: "t", commitsAhead: 0, commitsBehind: 9, docsDiffer: 41, vsAtlasCommit: "l" } },
      },
    };
    expect(baseLine(meta, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe(
      `redlined against acme/fork:main · 9 commits behind main · 41 docs differ`,
    );
  });

  it("repo key: pluralizes singular commit/doc counts", () => {
    const m = meta({
      auto: "repo",
      repo: {
        repo: "acme/fork",
        ref: "main",
        mergeBase: "x",
        drift: { sha: "s", commitsAhead: 1, commitsBehind: 1, docsDiffer: 1, vsAtlasCommit: "v" },
      },
    });
    expect(baseLine(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe(
      `redlined against acme/fork:main · base forked from ${CANONICAL_MAIN} 1 commit ago · 1 commit behind main · 1 doc differs`,
    );
  });

  it("repo key: up to date with sky main collapses the two commit segments", () => {
    const m = meta({
      auto: "repo",
      repo: {
        repo: "acme/fork",
        ref: "main",
        mergeBase: "x",
        drift: { sha: "s", commitsAhead: 0, commitsBehind: 0, docsDiffer: 2, vsAtlasCommit: "v" },
      },
    });
    expect(baseLine(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe(
      `redlined against acme/fork:main · base is up to date with ${CANONICAL_MAIN} · 2 docs differ`,
    );
  });

  it("repo key: omits drift entirely when the repo base IS sky main (PR against canonical)", () => {
    const [repo, ref] = CANONICAL_MAIN.split(":");
    const m = meta({
      auto: "repo",
      repo: { repo, ref, mergeBase: "x", drift: { sha: "s", commitsAhead: 0, commitsBehind: 0, vsAtlasCommit: "v" } },
    });
    expect(baseLine(m, { key: "repo", repo, ref, auto: true })).toBe(`redlined against ${CANONICAL_MAIN}`);
  });

  it("repo key with no repo candidate on the meta renders nothing", () => {
    expect(baseLine(meta({ auto: "sky", sky: { repo: "a", ref: "b", mergeBase: "x" } }), { key: "repo", auto: false })).toBe(
      "",
    );
  });

  it("live-main note includes the reason when present", () => {
    const m = meta({ auto: "live-main", reason: "no fork point found" });
    expect(baseLine(m, { key: "live-main", auto: true })).toBe("redlined against live main (no fork point found)");
  });

  it("live-main note omits the parenthetical when no reason given", () => {
    const m = meta({ auto: "live-main" });
    expect(baseLine(m, { key: "live-main", auto: true })).toBe("redlined against live main");
  });

  it("falls back to meta.bases.auto when the diff hasn't resolved activeBase yet (avoids a wrong-line flicker)", () => {
    const m = meta({ auto: "live-main", reason: "x" });
    expect(baseLine(m, null)).toBe("redlined against live main (x)");
  });
});

describe("baseSwitch", () => {
  const BASES: PreviewBases = {
    auto: "sky",
    sky: { repo: "sky-ecosystem/next-gen-atlas", ref: "main", mergeBase: "x" },
    repo: { repo: "acme/fork", ref: "develop", mergeBase: "y" },
  };

  it("returns null when only one candidate exists", () => {
    const only = meta({ auto: "sky", sky: BASES.sky });
    expect(baseSwitch(only, { key: "sky", auto: true }, "")).toBeNull();
  });

  it("returns null when bases is entirely absent (old bundle)", () => {
    expect(baseSwitch(meta(undefined), null, "")).toBeNull();
  });

  it("auto view offers the other candidate", () => {
    const r = baseSwitch(meta(BASES), { key: "sky", auto: true }, "");
    expect(r).toEqual({ href: "?base=repo", label: "compare against acme/fork:develop instead" });
  });

  it("forced override offers a link back to auto", () => {
    const r = baseSwitch(meta(BASES), { key: "repo", repo: "acme/fork", ref: "develop", auto: false }, "?base=repo");
    expect(r).toEqual({ href: "?", label: "back to sky-ecosystem/next-gen-atlas:main" });
  });

  it("preserves other query params through the switch", () => {
    const r = baseSwitch(meta(BASES), { key: "sky", auto: true }, "?subset=changed&q=foo");
    expect(r?.href).toBe("?subset=changed&q=foo&base=repo");
  });

  it("preserves other query params when reverting a forced override", () => {
    const r = baseSwitch(
      meta(BASES),
      { key: "repo", repo: "acme/fork", ref: "develop", auto: false },
      "?base=repo&subset=changed",
    );
    expect(r?.href).toBe("?subset=changed");
  });
});

describe("pullsPermissionCopy", () => {
  it("returns null when the flag is off", () => {
    expect(pullsPermissionCopy({})).toBeNull();
    expect(pullsPermissionCopy({ needsPullsPermission: false })).toBeNull();
  });

  it("links to GitHub's permission review screen when a URL is present", () => {
    const r = pullsPermissionCopy({
      needsPullsPermission: true,
      permissionsUrl: "https://github.com/settings/installations/1/permissions/update",
    });
    expect(r?.href).toBe("https://github.com/settings/installations/1/permissions/update");
    expect(r?.linkLabel).toBe("Review permissions on GitHub ↗");
    expect(r?.body).toMatch(/review the new permission on GitHub/);
    expect(r?.body).toMatch(/reload this page/);
  });

  it("asks the owner when there is no review URL", () => {
    const r = pullsPermissionCopy({ needsPullsPermission: true });
    expect(r?.href).toBeNull();
    expect(r?.body).toMatch(/Ask the person who installed the App/);
    expect(r?.body).not.toMatch(/If you own or administer/);
  });
});

describe("broadGrantCopy", () => {
  it("returns null when the flag is off", () => {
    expect(broadGrantCopy({ repo: "acme/atlas" })).toBeNull();
    expect(broadGrantCopy({ repo: "acme/atlas", grantTooBroad: false })).toBeNull();
  });

  it("names the one repo and links to the install's settings page", () => {
    const r = broadGrantCopy({
      repo: "acme/atlas",
      grantTooBroad: true,
      installSettingsUrl: "https://github.com/organizations/acme/settings/installations/9",
    });
    expect(r?.label).toBe("ACCESS");
    expect(r?.href).toBe("https://github.com/organizations/acme/settings/installations/9");
    expect(r?.linkLabel).toBe("Narrow repository access on GitHub ↗");
    expect(r?.body).toMatch(/only needs acme\/atlas/);
    expect(r?.body).toMatch(/If you own or administer the install/);
  });

  it("asks the owner when there is no settings URL", () => {
    const r = broadGrantCopy({ repo: "acme/atlas", grantTooBroad: true });
    expect(r?.href).toBeNull();
    expect(r?.body).toMatch(/Ask the person who installed the App/);
    expect(r?.body).not.toMatch(/If you own or administer/);
  });
});

describe("diffBaseLabel", () => {
  it("says the live atlas for sky/absent", () => {
    expect(diffBaseLabel(meta(undefined), null)).toBe("the live atlas");
    expect(diffBaseLabel(meta({ auto: "sky" }), { key: "sky", auto: true })).toBe("the live atlas");
  });

  it("names repo:ref for the repo base", () => {
    const m = meta({ auto: "repo", repo: { repo: "acme/fork", ref: "main", mergeBase: "x" } });
    expect(diffBaseLabel(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe("acme/fork:main");
  });

  it("falls back to the live atlas when the repo candidate is missing from meta", () => {
    expect(diffBaseLabel(meta({ auto: "sky" }), { key: "repo", auto: false })).toBe("the live atlas");
  });
});
