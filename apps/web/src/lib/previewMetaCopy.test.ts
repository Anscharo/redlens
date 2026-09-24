import { describe, it, expect, vi } from "vitest";
import { compareLine, previewTabTitle, baseSwitch, broadGrantCopy, diffBaseLabel, pullsPermissionCopy, dismissAccessRepo, readDismissedAccessRepos, type PreviewMeta, type PreviewBases } from "./previewMetaCopy";

function meta(bases?: PreviewBases, extra: Partial<PreviewMeta> = {}): PreviewMeta {
  return { sha: "x", repo: "r", ref: "b", kind: "branch", ...extra, bases };
}

describe("compareLine", () => {
  it("names head, title, and base, and leaves the author out", () => {
    const m = meta(
      { auto: "repo", repo: { repo: "acme/fork", ref: "main", mergeBase: "x", drift: { sha: "s", docsDiffer: 0, vsAtlasCommit: "v" } } },
      { ref: "feat/x", prTitle: "Add a thing", prAuthor: "alice" },
    );
    expect(compareLine(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe(
      "Comparing feat/x — Add a thing to acme/fork:main",
    );
  });

  it("omits a missing title and does not mention base-vs-atlas drift", () => {
    const m = meta({
      auto: "repo",
      repo: {
        repo: "acme/fork",
        ref: "main",
        mergeBase: "x",
        drift: { sha: "s", commitsAhead: 0, commitsBehind: 9, docsDiffer: 0, vsAtlasCommit: "v" },
      },
    }, { ref: "feat/x", prAuthor: "alice" });
    expect(compareLine(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).toBe(
      "Comparing feat/x to acme/fork:main",
    );
    expect(compareLine(m, { key: "repo", repo: "acme/fork", ref: "main", auto: true })).not.toMatch(/docs differ|redlined|by alice/);
  });

  it("does not name the fork owner", () => {
    expect(compareLine(meta(undefined, { ref: "sneaky", forkOwner: "mallory" }), null)).toBe("Comparing sneaky");
  });

  it("names live main, without the degraded reason", () => {
    const m = meta({ auto: "live-main", reason: "no fork point found" }, { ref: "main" });
    expect(compareLine(m, { key: "live-main", auto: true })).toBe("Comparing main to live main");
    expect(compareLine(m, null)).toBe("Comparing main to live main");
  });

  it("falls back to the sky candidate before activeBase resolves", () => {
    const m = meta({ auto: "sky", sky: { repo: "acme/fork", ref: "feature", mergeBase: "x" } }, { ref: "feature" });
    expect(compareLine(m, null)).toBe("Comparing feature to acme/fork:feature");
  });
});

describe("previewTabTitle", () => {
  it("names the PR and the branch", () => {
    expect(previewTabTitle(meta(undefined, { ref: "feat/x", prNumber: 88, prTitle: "Add a thing" }))).toBe(
      "PR 88 preview on Sky Atlas by Redline -- feat/x — Add a thing",
    );
  });

  it("uses a pull-N ref's number and title when there is no branch name", () => {
    expect(previewTabTitle(meta(undefined, { ref: "pull-7", prTitle: "Spark" }))).toBe(
      "PR 7 preview on Sky Atlas by Redline -- Spark",
    );
  });

  it("names the branch when the preview is not a pull request", () => {
    expect(previewTabTitle(meta(undefined, { ref: "feature", kind: "branch" }))).toBe(
      "Preview feature on Sky Atlas by Redline",
    );
    expect(previewTabTitle(meta(undefined, { ref: "", sha: "abcdef1234567890", kind: "sha" }))).toBe(
      "Preview abcdef1 on Sky Atlas by Redline",
    );
    expect(previewTabTitle(null)).toBeNull();
  });
});

describe("access dismiss", () => {
  it("remembers a dismissed repo in localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    });
    expect(readDismissedAccessRepos().size).toBe(0);
    dismissAccessRepo("acme/secret-atlas");
    expect(readDismissedAccessRepos().has("acme/secret-atlas")).toBe(true);
    expect(readDismissedAccessRepos().has("other/repo")).toBe(false);
    vi.unstubAllGlobals();
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
