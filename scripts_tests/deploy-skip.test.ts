import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  APP_READ_MARKDOWN,
  isAppReadMarkdown,
  isDeployRelevant,
  isMarkdownPath,
  normalizeRepoPath,
  prNumberFromRailwayEnv,
  railwayWebWatchPatterns,
  railwayWorkerWatchPatterns,
  shouldSkipDeploy,
} from "../scripts/lib/deploy-skip.mjs";

const ROOT = path.resolve(__dirname, "..");

function walkSrc(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walkSrc(p, acc);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function appReadMarkdownFromSrc(): string[] {
  const re = /from\s+["']([^"']+\.md)\?raw["']/g;
  const found = new Set<string>();
  for (const file of walkSrc(path.join(ROOT, "src"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      const abs = path.resolve(path.dirname(file), m[1]);
      found.add(path.relative(ROOT, abs).replaceAll("\\", "/"));
    }
  }
  return [...found].sort();
}

function tomlWatchPatterns(file: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const block = /watchPatterns\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (!block) throw new Error(`${file} has no watchPatterns array`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("shouldSkipDeploy", () => {
  it("skips skills, CLAUDE.md, and plan docs", () => {
    expect(shouldSkipDeploy([".claude/skills/react-components/SKILL.md", "CLAUDE.md"])).toBe(true);
    expect(shouldSkipDeploy(["docs/plans/frontend-test-plan.md"])).toBe(true);
    expect(shouldSkipDeploy(["README.md"])).toBe(true);
  });

  it("deploys app-bundled markdown and any non-markdown path", () => {
    expect(shouldSkipDeploy(["patch-notes.md"])).toBe(false);
    expect(shouldSkipDeploy(["PRIVACY.md"])).toBe(false);
    expect(shouldSkipDeploy(["docs/crossview/concepts.md"])).toBe(false);
    expect(shouldSkipDeploy(["docs/crossview/concepts-audit.md"])).toBe(false);
    expect(shouldSkipDeploy(["docs/risk-assessment-rubric.md"])).toBe(false);
    expect(shouldSkipDeploy(["src/App.tsx"])).toBe(false);
    expect(shouldSkipDeploy(["CLAUDE.md", "src/index.css"])).toBe(false);
  });

  it("does not skip an empty or unknown file list", () => {
    expect(shouldSkipDeploy([])).toBe(false);
    expect(shouldSkipDeploy(undefined as unknown as string[])).toBe(false);
  });

  it("treats only .md as markdown", () => {
    expect(isMarkdownPath("foo.md")).toBe(true);
    expect(isMarkdownPath("foo.MD")).toBe(true);
    expect(isMarkdownPath("foo.mdx")).toBe(false);
    expect(isDeployRelevant("e2e/health.ts")).toBe(true);
  });

  it("normalizes slashes, ./ prefixes, and the app-read allowlist", () => {
    expect(normalizeRepoPath(".\\docs\\crossview\\concepts.md")).toBe("docs/crossview/concepts.md");
    expect(normalizeRepoPath("./patch-notes.md")).toBe("patch-notes.md");
    expect(isAppReadMarkdown("./PRIVACY.md")).toBe(true);
    expect(isAppReadMarkdown("docs\\crossview\\concepts.md")).toBe(true);
    expect(isAppReadMarkdown("README.md")).toBe(false);
    expect(isDeployRelevant("./patch-notes.md")).toBe(true);
    expect(isDeployRelevant("docs\\plans\\x.md")).toBe(false);
  });
});

describe("prNumberFromRailwayEnv", () => {
  it("parses Railway PR environment slugs", () => {
    expect(prNumberFromRailwayEnv("Redline Atlas / pr-85d143-128")).toBe(128);
    expect(prNumberFromRailwayEnv("Redline Atlas / redlens-pr-292")).toBe(292);
    expect(prNumberFromRailwayEnv("redlens-pr-292")).toBe(292);
    expect(prNumberFromRailwayEnv("pr-292")).toBe(292);
    expect(prNumberFromRailwayEnv("production")).toBeNull();
    expect(prNumberFromRailwayEnv("Redline Atlas / production")).toBeNull();
  });
});

describe("allowlist stays honest", () => {
  it("APP_READ_MARKDOWN matches every src/ `?raw` markdown import", () => {
    expect(appReadMarkdownFromSrc()).toEqual([...APP_READ_MARKDOWN].sort());
  });

  it("railway.toml watchPatterns match railwayWebWatchPatterns()", () => {
    expect(tomlWatchPatterns("railway.toml")).toEqual(railwayWebWatchPatterns());
  });

  it("railway.worker.toml ignores all markdown", () => {
    expect(tomlWatchPatterns("railway.worker.toml")).toEqual(railwayWorkerWatchPatterns());
  });

  it("e2e.yml names every APP_READ_MARKDOWN path", () => {
    const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/e2e.yml"), "utf8");
    for (const file of APP_READ_MARKDOWN) {
      expect(yml, `e2e.yml is missing allowlist entry ${file}`).toContain(file);
    }
  });
});
