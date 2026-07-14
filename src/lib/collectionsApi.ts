import { apiUrl } from "../components/chat/api";

// Typed fetch wrappers for the /api/collections REST endpoints (auth-gated via
// cookie). Every call is same-origin, mirroring the chat API helpers.
export type Collection = {
  id: string;
  name: string;
  ids: string[];
  updatedAt: string;
};

// Max length for a collection name. The "NAME · n" sidebar pill shows the full
// name when there's room and truncates (CSS) only when the row is cramped.
// Enforced on both the create + rename inputs.
export const MAX_COLLECTION_NAME_LEN = 32;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore — non-JSON error body
    }
    throw new Error(`collections request failed: ${message}`);
  }
  return res.json() as Promise<T>;
}

export function listCollections(): Promise<Collection[]> {
  return request<Collection[]>("collections");
}

export function createCollection(name: string, ids: string[]): Promise<Collection> {
  return request<Collection>("collections", {
    method: "POST",
    body: JSON.stringify({ name, ids }),
  });
}

export function renameCollection(id: string, name: string): Promise<Collection> {
  return request<Collection>(`collections/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteCollection(id: string): Promise<void> {
  await request<{ ok: true }>(`collections/${id}`, { method: "DELETE" });
}
