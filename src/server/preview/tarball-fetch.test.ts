// fetchArchive + fetchAndExtract: the network half of tarball.ts. Pure parts
// (archiveUrl, gunzipCapped, extractContentArchive) are covered in
// preview.test.ts. Stubs globalThis.fetch the same way open-prs.test.ts does,
// restored in afterAll.
import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fetchArchive, fetchAndExtract, SourceGoneError } from "./tarball.ts";

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

test("fetchArchive: 404 → SourceGoneError", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve({ status: 404, ok: false, body: null } as Response);
  await expect(fetchArchive("owner/repo", "abc", "tok")).rejects.toBeInstanceOf(SourceGoneError);
});

test("fetchArchive: other non-ok status → plain Error", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve({ status: 500, ok: false, body: null } as Response);
  await expect(fetchArchive("owner/repo", "abc", "tok")).rejects.toThrow(/archive fetch failed 500/);
});

test("fetchArchive: ok with no body → Error", async () => {
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve({ status: 200, ok: true, body: null } as Response);
  await expect(fetchArchive("owner/repo", "abc", "tok")).rejects.toThrow(/archive fetch failed/);
});

test("fetchArchive: ok → returns the response body stream, request includes auth header", async () => {
  let capturedInit: RequestInit | undefined;
  let capturedUrl: string | undefined;
  const body = new ReadableStream();
  // @ts-expect-error stub
  globalThis.fetch = (url: string, init: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Promise.resolve({ status: 200, ok: true, body } as Response);
  };
  const result = await fetchArchive("owner/repo", "abc123", "my-token");
  expect(result).toBe(body);
  expect(capturedUrl).toBe("https://github.com/owner/repo/archive/abc123.tar.gz");
  expect((capturedInit!.headers as any).authorization).toBe("Bearer my-token");
});

test("fetchArchive: apiTarball → hits api.github.com/.../tarball/... with a Bearer header", async () => {
  let capturedInit: RequestInit | undefined;
  let capturedUrl: string | undefined;
  const body = new ReadableStream();
  // @ts-expect-error stub
  globalThis.fetch = (url: string, init: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Promise.resolve({ status: 200, ok: true, body } as Response);
  };
  const result = await fetchArchive("owner/private-repo", "abc123", "inst-token", { apiTarball: true });
  expect(result).toBe(body);
  expect(capturedUrl).toBe("https://api.github.com/repos/owner/private-repo/tarball/abc123");
  expect((capturedInit!.headers as any).authorization).toBe("Bearer inst-token");
  expect(capturedInit!.redirect).toBe("follow");
});

test("fetchArchive: no token → no authorization header", async () => {
  let capturedInit: RequestInit | undefined;
  // @ts-expect-error stub
  globalThis.fetch = (_url: string, init: RequestInit) => {
    capturedInit = init;
    return Promise.resolve({ status: 200, ok: true, body: new ReadableStream() } as Response);
  };
  await fetchArchive("owner/repo", "abc123", "");
  expect((capturedInit!.headers as any).authorization).toBeUndefined();
});

function makeAtlasTarGz(docs: Record<string, string>): Buffer {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mk-tar-fa-"));
  const top = path.join(work, "next-gen-atlas-abc");
  for (const [rel, body] of Object.entries(docs)) {
    const f = path.join(top, "content", rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  const gzPath = path.join(work, "a.tar.gz");
  execFileSync("tar", ["-czf", gzPath, "-C", work, "next-gen-atlas-abc"]);
  const gz = fs.readFileSync(gzPath);
  fs.rmSync(work, { recursive: true, force: true });
  return gz;
}

test("fetchAndExtract: fetch + gunzip + extract end to end", async () => {
  const gz = makeAtlasTarGz({ "A/0/document.md": "preamble" });
  // Build a real ReadableStream<Uint8Array> from the gz bytes so
  // Readable.fromWeb(...) inside fetchAndExtract works.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(gz));
      controller.close();
    },
  });
  // @ts-expect-error stub
  globalThis.fetch = () => Promise.resolve({ status: 200, ok: true, body: stream } as Response);
  const atlasDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-fa-"));
  const { srcDir, docCount } = await fetchAndExtract("owner/repo", "abc", "tok", atlasDir);
  expect(docCount).toBe(1);
  expect(fs.readFileSync(path.join(srcDir, "content/A/0/document.md"), "utf8")).toBe("preamble");
  fs.rmSync(atlasDir, { recursive: true, force: true });
});
