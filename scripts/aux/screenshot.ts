// pnpm screenshot — shoot the app in every theme without a database or the Bun
// API server. Vite serves the SPA; the browser's /api/atlas/<sha>/<file>
// requests are answered from public/<file> on disk, and every other /api or /z
// call gets an instant 404, so the reader, search and reports render
// as they do in production and nothing waits on a proxy that has no backend.
//
//   pnpm screenshot                                # every theme × default routes
//   pnpm screenshot --theme winter --route "/atlas?id=<uuid>"
//   pnpm screenshot --out <dir> --scale 2 --wait 6000
//
// Missing atlas artifacts are built first (submodule → index → graph →
// glossary). Vite is started on :5173 when nothing answers there, and stopped
// at exit; one already running is reused and left alone.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type BrowserContext } from "@playwright/test";

const ROOT = path.resolve(import.meta.dir, "../..");
// The app's own theme registry and storage key, loaded at runtime. The path is
// a variable so tsc does not follow it: theme.ts is a browser module, and the
// scripts typecheck has no DOM lib.
const THEME_MODULE = path.join(ROOT, "apps/web/src/lib/theme.ts");
const { THEMES, THEME_KEY } = (await import(THEME_MODULE)) as { THEMES: { id: string }[]; THEME_KEY: string };
const PUBLIC = path.join(ROOT, "public");
const ORIGIN = "http://localhost:5173";
const DEFAULT_ROUTES = ["/", "/?q=facilitator", "/atlas?id=86a93dab-2f12-4c3f-9285-bcc4520c851b", "/reports"];
// The browser bundled in the cloud image; the repo's own Playwright may pin a
// different build, so an existing binary here wins over Playwright's default.
const IMAGE_CHROMIUM = "/opt/pw-browsers/chromium";

const { values: opts } = parseArgs({
  options: {
    theme: { type: "string", multiple: true },
    route: { type: "string", multiple: true },
    out: { type: "string", default: path.join(ROOT, ".cache/screenshots") },
    scale: { type: "string", default: "1" },
    wait: { type: "string", default: "5000" },
  },
});

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`screenshot: \`${cmd} ${args.join(" ")}\` failed`);
}

function ensureArtifacts(): void {
  if (!fs.existsSync(path.join(ROOT, "vendor/next-gen-atlas/content"))) run("pnpm", ["pull-atlas"]);
  if (!fs.existsSync(path.join(PUBLIC, "docs.json"))) run("pnpm", ["build:index"]);
  if (!fs.existsSync(path.join(PUBLIC, "relations.json"))) run("pnpm", ["build:graph"]);
  if (!fs.existsSync(path.join(PUBLIC, "glossary.json"))) run("pnpm", ["build:glossary"]);
}

async function answers(url: string): Promise<boolean> {
  return fetch(url).then((r) => r.ok, () => false);
}

/** Starts Vite unless one already answers; resolves to the child to stop, or null. */
async function ensureVite(): Promise<ChildProcess | null> {
  if (await answers(ORIGIN)) return null;
  const child = spawn("pnpm", ["--filter", "sabr-web", "exec", "vite", "--port", "5173", "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    if (await answers(ORIGIN)) return child;
    await Bun.sleep(1000);
  }
  throw new Error("screenshot: Vite did not answer on :5173 within 60s");
}

/** Serves /api/atlas/<sha>/<file> from public/ and 404s the rest of the API. */
async function routeApi(ctx: BrowserContext): Promise<void> {
  await ctx.route((url) => /^\/(api|z)\//.test(url.pathname), (route) => {
    const m = route.request().url().match(/\/api\/atlas\/[0-9a-f]{40}\/([^?#]+)/);
    const file = m && path.join(PUBLIC, m[1]);
    if (file && file.startsWith(PUBLIC + path.sep) && fs.existsSync(file)) return route.fulfill({ path: file });
    return route.fulfill({ status: 404, body: "" });
  });
}

function slug(route: string): string {
  return route.replace(/^\//, "").replace(/[^\w-]+/g, "_").slice(0, 60) || "home";
}

async function shootTheme(theme: string, routes: string[], launch: () => ReturnType<typeof chromium.launch>) {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(opts.scale) });
    await ctx.addInitScript(([key, t]) => {
      try {
        localStorage.setItem(key, t);
      } catch {}
    }, [THEME_KEY, theme]);
    await routeApi(ctx);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.warn(`  [${theme}] page error: ${e.message}`));
    for (const route of routes) {
      // "load", not "networkidle": the app polls (health, the atlas updater) and
      // Vite holds an HMR socket open, so the network never goes idle.
      await page.goto(ORIGIN + route, { waitUntil: "load", timeout: 90_000 });
      await page.waitForTimeout(Number(opts.wait));
      const file = path.join(opts.out!, `${theme}-${slug(route)}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  ensureArtifacts();
  fs.mkdirSync(opts.out!, { recursive: true });
  const vite = await ensureVite();
  const launch = () => chromium.launch(fs.existsSync(IMAGE_CHROMIUM) ? { executablePath: IMAGE_CHROMIUM } : {});
  try {
    for (const theme of opts.theme ?? THEMES.map((t) => t.id)) await shootTheme(theme, opts.route ?? DEFAULT_ROUTES, launch);
  } finally {
    if (vite?.pid) process.kill(-vite.pid);
  }
}

await main();
