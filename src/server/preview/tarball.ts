// Tarball fetch + bounded extraction.
//
// Downloads a GitHub archive (`<repo>/archive/<sha>.tar.gz`) and extracts it into
// an isolated atlas dir. Two safety layers:
//   1. Bomb guard — we gunzip the stream ourselves with a running byte counter
//      and abort the moment decompressed output exceeds maxBytes, BEFORE that
//      many bytes are ever buffered or written. (Bun.Archive on the raw .gz would
//      inflate unbounded to disk.)
//   2. Tar parsing + path containment — delegated to the native `Bun.Archive`,
//      which keeps every extracted path inside the target dir (verified: `../`
//      traversal entries are collapsed in-bounds, never escape).
//
// Only the archive's `<top>/content/**` is used by the build (atlas-source.mjs
// reads ATLAS_SRC_DIR and detects the layout there); other top-level files
// (README, sync/, …) are extracted alongside but ignored. ATLAS_SRC_DIR is the
// single top-level dir.

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { bucketFromFilename } from "../../../scripts/lib/atlas-source.mjs";
import { config } from "../config.ts";

export interface ExtractCaps {
  maxBytes: number;
  maxDocs: number;
}
// maxBytes bounds the FULL decompressed archive (we gunzip the whole tar so
// Bun.Archive can parse it safely), not content/ alone. Measured 2026-06: the
// live atlas archive is ~33.5MB decompressed (content/ + a 12MB Static/ + the
// 3.4MB composed monolith + sync/). 64MB gives ~90% growth headroom and caps a
// fork's decompression bomb. Tunable via env without a code change.
export const DEFAULT_CAPS: ExtractCaps = {
  maxBytes: config.previewMaxDecompressedBytes,
  maxDocs: config.previewMaxDocs,
};

export class CapExceededError extends Error {}
export class SourceGoneError extends Error {}

export function archiveUrl(repo: string, sha: string): string {
  return `https://github.com/${repo}/archive/${sha}.tar.gz`;
}

/** The API tarball endpoint (vs. the web archive host above) — required for
 *  private repos: an installation-token Bearer isn't honored on
 *  github.com/.../archive/..., only on api.github.com. GitHub 302s this to a
 *  signed, unauthenticated codeload URL, hence redirect:"follow". */
export function apiTarballUrl(repo: string, sha: string): string {
  return `https://api.github.com/repos/${repo}/tarball/${sha}`;
}

export interface FetchArchiveOpts {
  apiTarball?: boolean;
}

export async function fetchArchive(
  repo: string,
  sha: string,
  token: string,
  opts?: FetchArchiveOpts,
): Promise<ReadableStream<Uint8Array>> {
  const res = opts?.apiTarball
    ? await fetch(apiTarballUrl(repo, sha), {
        headers: {
          "user-agent": "redlens-preview",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
        redirect: "follow",
      })
    : await fetch(archiveUrl(repo, sha), {
        headers: { "user-agent": "redlens-preview", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        redirect: "follow",
      });
  if (res.status === 404) throw new SourceGoneError(`archive 404 for ${repo}@${sha}`);
  if (!res.ok || !res.body) throw new Error(`archive fetch failed ${res.status} for ${repo}@${sha}`);
  return res.body;
}

/**
 * Gunzip a stream into a single Buffer, aborting if decompressed output exceeds
 * maxBytes. The cap is checked per chunk, so a gzip bomb dies after at most one
 * highWaterMark past the limit — never the full expansion.
 */
export async function gunzipCapped(input: Readable, maxBytes: number): Promise<Buffer> {
  const gunzip = createGunzip();
  input.pipe(gunzip);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const c of gunzip as AsyncIterable<Buffer>) {
      total += c.length;
      if (total > maxBytes) throw new CapExceededError(`decompressed > ${maxBytes} bytes`);
      chunks.push(Buffer.from(c));
    }
  } catch (e) {
    try {
      gunzip.destroy();
      input.destroy?.();
    } catch {
      /* ignore */
    }
    throw e;
  }
  return Buffer.concat(chunks);
}

// Documents in an extracted content/ tree, whichever layout it is in. Counting
// `document.md` files alone silently returned 0 for the consolidated layout —
// which made the maxDocs cap inert and reported docCount: 0 on every preview.
const HEADING_UUID_RE = /<!-- UUID: [0-9a-f-]{36} -->/g;

function countDocs(dir: string): number {
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        stack.push(path.join(d, e.name));
      } else if (e.name === "document.md") {
        n++; // atomized: one file, one document
      } else if (bucketFromFilename(e.name)) {
        // consolidated: one composed file, many documents — count the headings.
        const text = fs.readFileSync(path.join(d, e.name), "utf8");
        n += text.match(HEADING_UUID_RE)?.length ?? 0;
      }
    }
  }
  return n;
}

/**
 * Extract a plain (already-gunzipped) tar Buffer into `atlasDir` via Bun.Archive,
 * then locate the single top-level dir containing `content/`. Enforces the doc
 * cap. Returns the atlas source dir (use as ATLAS_SRC_DIR) and document count.
 */
export async function extractContentArchive(
  plainTar: Buffer,
  atlasDir: string,
  caps: ExtractCaps = DEFAULT_CAPS,
): Promise<{ srcDir: string; docCount: number }> {
  fs.mkdirSync(atlasDir, { recursive: true });
  // Bun.Archive is native (Bun ≥1.3); not yet in @types/bun.
  await new (Bun as any).Archive(plainTar).extract(atlasDir);

  const tops = fs
    .readdirSync(atlasDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const top = tops.find((t) => fs.existsSync(path.join(atlasDir, t, "content")));
  if (!top) {
    fs.rmSync(atlasDir, { recursive: true, force: true });
    throw new Error("archive has no content/ directory");
  }

  const srcDir = path.join(atlasDir, top);
  const docCount = countDocs(path.join(srcDir, "content"));
  if (docCount > caps.maxDocs) {
    fs.rmSync(atlasDir, { recursive: true, force: true });
    throw new CapExceededError(`> ${caps.maxDocs} documents`);
  }
  return { srcDir, docCount };
}

/** Fetch + bomb-guarded gunzip + extract in one call. Network. */
export async function fetchAndExtract(
  repo: string,
  sha: string,
  token: string,
  atlasDir: string,
  caps: ExtractCaps = DEFAULT_CAPS,
  opts?: FetchArchiveOpts,
): Promise<{ srcDir: string; docCount: number }> {
  const body = await fetchArchive(repo, sha, token, opts);
  const plainTar = await gunzipCapped(Readable.fromWeb(body as any), caps.maxBytes);
  return extractContentArchive(plainTar, atlasDir, caps);
}
