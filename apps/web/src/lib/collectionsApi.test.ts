import { describe, it, expect, vi, afterEach } from "vitest";
import {
  listCollections,
  createCollection,
  renameCollection,
  updateCollectionItems,
  getSharedCollection,
  deleteCollection,
  MAX_COLLECTION_NAME_LEN,
} from "./collectionsApi";

function mockFetch(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MAX_COLLECTION_NAME_LEN", () => {
  it("is 32", () => {
    expect(MAX_COLLECTION_NAME_LEN).toBe(32);
  });
});

describe("listCollections", () => {
  it("GETs /api/collections and returns the parsed list", async () => {
    const fn = mockFetch(jsonResponse([{ id: "1", name: "A", ids: [], updatedAt: "t" }]));
    const result = await listCollections();
    expect(result).toEqual([{ id: "1", name: "A", ids: [], updatedAt: "t" }]);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/collections");
    expect(init).toMatchObject({ credentials: "same-origin", headers: { "content-type": "application/json" } });
  });
});

describe("createCollection", () => {
  it("POSTs the name and ids, returning the created collection", async () => {
    const fn = mockFetch(jsonResponse({ id: "2", name: "New", ids: ["a", "b"], updatedAt: "t" }));
    const result = await createCollection("New", ["a", "b"]);
    expect(result.id).toBe("2");
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/collections");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "New", ids: ["a", "b"] });
  });
});

describe("renameCollection", () => {
  it("PATCHes /api/collections/:id with the new name", async () => {
    const fn = mockFetch(jsonResponse({ id: "1", name: "Renamed", ids: [], updatedAt: "t" }));
    await renameCollection("1", "Renamed");
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/collections/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Renamed" });
  });
});

describe("updateCollectionItems", () => {
  it("PATCHes /api/collections/:id with new ids", async () => {
    const fn = mockFetch(jsonResponse({ id: "1", name: "A", ids: ["x"], updatedAt: "t" }));
    await updateCollectionItems("1", ["x"]);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/collections/1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ ids: ["x"] });
  });
});

describe("getSharedCollection", () => {
  it("GETs the public shared-collection path", async () => {
    const fn = mockFetch(jsonResponse({ id: "1", name: "Shared", ids: [], updatedAt: "t" }));
    await getSharedCollection("1");
    const [url] = fn.mock.calls[0];
    expect(url).toBe("/api/collections/1/shared");
  });
});

describe("deleteCollection", () => {
  it("DELETEs /api/collections/:id and resolves with no value", async () => {
    const fn = mockFetch(jsonResponse({ ok: true }));
    await expect(deleteCollection("1")).resolves.toBeUndefined();
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/collections/1");
    expect(init?.method).toBe("DELETE");
  });
});

describe("error handling", () => {
  it("throws with the server's JSON error message on a non-ok response", async () => {
    mockFetch(jsonResponse({ error: "collection limit reached" }, 429));
    await expect(listCollections()).rejects.toThrow(/collection limit reached/);
  });

  it("falls back to status + statusText when the error body isn't JSON", async () => {
    mockFetch(new Response("not json", { status: 500, statusText: "Internal Server Error" }));
    await expect(listCollections()).rejects.toThrow(/500/);
  });

  it("falls back to status + statusText when the JSON body has no 'error' field", async () => {
    mockFetch(jsonResponse({ unrelated: true }, 404));
    await expect(listCollections()).rejects.toThrow(/404/);
  });
});
