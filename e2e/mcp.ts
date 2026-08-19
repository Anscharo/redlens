import type { APIRequestContext } from "@playwright/test";

interface JsonRpcEnvelope {
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: { code?: number; message?: string; data?: unknown };
}

interface CallOptions {
  attempts?: number;
  sleep?: (ms: number) => Promise<unknown>;
}

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function parseMcpEnvelope(raw: string): JsonRpcEnvelope {
  try {
    return JSON.parse(raw) as JsonRpcEnvelope;
  } catch {
    const events = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter((line) => line && line !== "[DONE]");
    for (const event of events) {
      try {
        const parsed = JSON.parse(event) as JsonRpcEnvelope;
        if (parsed.result || parsed.error) return parsed;
      } catch {
        // Keep looking: SSE streams may contain progress/non-JSON events.
      }
    }
  }
  throw new Error(`MCP returned neither JSON nor a JSON-RPC SSE event: ${raw.slice(0, 500)}`);
}

function toolError(name: string, detail: string, raw?: string): Error {
  return new Error(`MCP tool ${name} failed: ${detail}${raw ? `; response=${raw.slice(0, 500)}` : ""}`);
}

export async function callTool<T extends Record<string, unknown>>(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
  { attempts = 3, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: CallOptions = {},
): Promise<T> {
  let lastTransportError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await request.post("/mcp", {
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      });
    } catch (error) {
      lastTransportError = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      throw toolError(name, `transport error after ${attempts} attempt(s): ${lastTransportError}`);
    }

    const raw = await response.text();
    if (!response.ok()) {
      const detail = `HTTP ${response.status()} ${response.statusText()}`;
      if (TRANSIENT_STATUSES.has(response.status()) && attempt < attempts) {
        lastTransportError = `${detail}: ${raw.slice(0, 500)}`;
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      throw toolError(name, detail, raw);
    }

    let envelope: JsonRpcEnvelope;
    try {
      envelope = parseMcpEnvelope(raw);
    } catch (error) {
      throw toolError(name, error instanceof Error ? error.message : String(error), raw);
    }
    if (envelope.error) {
      throw toolError(name, `JSON-RPC ${envelope.error.code ?? "error"}: ${envelope.error.message ?? "unknown"}`, raw);
    }
    const text = envelope.result?.content?.find((part) => part.type === "text" || part.text)?.text;
    if (!text) throw toolError(name, "response contained no text result", raw);
    if (envelope.result?.isError) throw toolError(name, text, raw);

    let payload: T;
    try {
      payload = JSON.parse(text) as T;
    } catch {
      throw toolError(name, `tool payload was not JSON: ${text.slice(0, 500)}`, raw);
    }
    if (typeof payload.error === "string") throw toolError(name, payload.error, text);
    return payload;
  }

  throw toolError(name, `transient transport failure: ${lastTransportError}`);
}
