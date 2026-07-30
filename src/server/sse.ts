// SSE client registry for atlas-update events.
// atlas-updater calls broadcastAtlasUpdate() after a successful in-place refresh.

type Client = {
  id: number;
  enqueue: (chunk: string) => void;
  close: () => void;
};

let nextId = 0;
const clients = new Map<number, Client>();

// Send a comment to all clients every 30s to keep Railway's proxy from
// closing idle connections. Dead clients (enqueue throws) are evicted.
const HEARTBEAT_MS = 30_000;
export function heartbeat(): void {
  for (const [id, c] of clients) {
    try { c.enqueue(":ping\n\n"); }
    catch { clients.delete(id); }
  }
}
setInterval(heartbeat, HEARTBEAT_MS).unref?.();

export function registerSSEClient(
  enqueue: (chunk: string) => void,
  close: () => void,
): () => void {
  const id = nextId++;
  clients.set(id, { id, enqueue, close });
  return () => clients.delete(id);
}

export function broadcastAtlasUpdate(atlasSha: string) {
  const msg = `event: atlas-update\ndata: ${JSON.stringify({ atlas_sha: atlasSha })}\n\n`;
  for (const [id, c] of clients) {
    try { c.enqueue(msg); }
    catch { clients.delete(id); }
  }
}
