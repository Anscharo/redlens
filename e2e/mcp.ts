import type { APIRequestContext } from "@playwright/test";

// Calling a tool on the REAL deployed MCP endpoint. A tool call comes back as a
// JSON-RPC envelope (JSON or SSE) whose result.content[0].text is the tool
// payload JSON — but a server-side failure comes back through the same channel
// as plain text ("Connection closed" when Postgres drops the pooled socket).
// Parsing that as JSON produced `SyntaxError: Unexpected token 'C'`, which named
// neither the tool nor the real error; everything here exists to say what
// actually went wrong, and to give a dropped connection a second chance.

/** Failures worth retrying: the socket died, not the request was wrong. */
const TRANSIENT =
  /connection closed|connection terminated|connection reset|socket hang up|ECONNRESET|EPIPE|ETIMEDOUT|apiRequestContext.*timeout|too many connections/i;

type Attempt =
  | { ok: true; payload: Record<string, any> }
  | { ok: false; error: string; transient: boolean };

function parseEnvelope(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    // The streamable-HTTP transport may answer as SSE.
  }
  const data = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const payload = data.find((d) => d.includes('"result"') || d.includes('"error"')) ?? data[data.length - 1];
  if (!payload) throw new Error(`unparseable /mcp response: ${text.slice(0, 300)}`);
  return JSON.parse(payload);
}

async function attempt(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Attempt> {
  let text: string;
  let status: number;
  try {
    const res = await request.post("/mcp", {
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      timeout: 30_000,
    });
    status = res.status();
    text = await res.text();
  } catch (e) {
    // Network-level: the request never completed. Always worth one more go.
    return { ok: false, error: `request failed: ${(e as Error).message}`, transient: true };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, error: `HTTP ${status}: ${text.slice(0, 300)}`, transient: status >= 500 };
  }

  let env: any;
  try {
    env = parseEnvelope(text);
  } catch (e) {
    return { ok: false, error: (e as Error).message, transient: false };
  }

  if (env?.error) {
    const message = String(env.error.message ?? JSON.stringify(env.error));
    return { ok: false, error: `JSON-RPC error ${env.error.code ?? "?"}: ${message}`, transient: TRANSIENT.test(message) };
  }

  const body = env?.result?.content?.[0]?.text;
  if (typeof body !== "string") {
    return { ok: false, error: `result carried no text content: ${JSON.stringify(env).slice(0, 300)}`, transient: false };
  }
  try {
    return { ok: true, payload: JSON.parse(body) };
  } catch {
    // The tool ran but returned an error string rather than its JSON payload.
    return { ok: false, error: `tool returned a non-JSON payload: ${body.slice(0, 300)}`, transient: TRANSIENT.test(body) };
  }
}

export async function callTool(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
  retries = 2,
): Promise<Record<string, any>> {
  let last = "no attempt was made";
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_000 * i));
    const res = await attempt(request, name, args);
    if (res.ok) return res.payload;
    last = res.error;
    if (!res.transient) break;
  }
  throw new Error(`atlas MCP tool "${name}" (${JSON.stringify(args)}) failed: ${last}`);
}
