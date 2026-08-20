import { describe, it, expect, vi, afterEach } from "vitest";
import {
  listConversations,
  getConversation,
  renameConversation,
  deleteConversation,
  MAX_CONVERSATION_TITLE_LEN,
} from "./conversationsApi";

/** A minimal Response stand-in for the bits request() reads. */
function jsonRes(data: unknown, ok = true, status = 200, statusText = "OK") {
  return { ok, status, statusText, json: async () => data } as unknown as Response;
}

function installFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listConversations", () => {
  it("GETs /api/chat/conversations and returns the parsed list", async () => {
    const rows = [{ id: "c1", title: "Foo", updatedAt: "t", messageCount: 2 }];
    const spy = installFetch(() => jsonRes(rows));
    const result = await listConversations();
    expect(result).toEqual(rows);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/chat/conversations");
    expect(init).toMatchObject({ credentials: "same-origin", headers: { "content-type": "application/json" } });
  });
});

describe("getConversation", () => {
  it("GETs /api/chat/conversations/:id and returns the parsed detail", async () => {
    const detail = { id: "c1", title: "Foo", updatedAt: "t", messages: [] };
    const spy = installFetch(() => jsonRes(detail));
    const result = await getConversation("c1");
    expect(result).toEqual(detail);
    expect(spy.mock.calls[0][0]).toBe("/api/chat/conversations/c1");
  });
});

describe("renameConversation", () => {
  it("PATCHes with the title in the body and returns the updated row", async () => {
    const updated = { id: "c1", title: "New", updatedAt: "t2" };
    const spy = installFetch(() => jsonRes(updated));
    const result = await renameConversation("c1", "New");
    expect(result).toEqual(updated);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/chat/conversations/c1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ title: "New" });
  });
});

describe("deleteConversation", () => {
  it("DELETEs the conversation and resolves with no return value", async () => {
    const spy = installFetch(() => jsonRes({ ok: true }));
    const result = await deleteConversation("c1");
    expect(result).toBeUndefined();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/api/chat/conversations/c1");
    expect(init?.method).toBe("DELETE");
  });
});

describe("request() error handling (exercised via listConversations)", () => {
  it("throws with the server's error body message on a non-ok response", async () => {
    installFetch(() => jsonRes({ error: "unauthenticated" }, false, 401, "Unauthorized"));
    await expect(listConversations()).rejects.toThrow("conversations request failed: unauthenticated");
  });

  it("falls back to status/statusText when the error body isn't JSON", async () => {
    installFetch(
      () =>
        ({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
    );
    await expect(listConversations()).rejects.toThrow("conversations request failed: 500 Internal Server Error");
  });

  it("falls back to status/statusText when the error body has no .error field", async () => {
    installFetch(() => jsonRes({}, false, 404, "Not Found"));
    await expect(listConversations()).rejects.toThrow("conversations request failed: 404 Not Found");
  });
});

describe("MAX_CONVERSATION_TITLE_LEN", () => {
  it("is the UI-facing 48-char cap", () => {
    expect(MAX_CONVERSATION_TITLE_LEN).toBe(48);
  });
});
