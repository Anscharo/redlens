import type {
  ResolvedEdge,
  GraphEntity,
  RelationEdge,
  GraphWorkerOutMessage,
  EntitySearchHit,
} from "@/types";
import { fetchJson } from "@/lib/verify";
import { captureException } from "./analytics";
import { liveAtlasBase, handledStale, handledStaleMessage } from "./atlasBase";
import type { GraphData } from "@/lib/graphData";

// GraphData moved to the DOM-free ./graphData so server-side report builders
// can import it without this worker/analytics layer. Re-exported here so
// existing `import type { GraphData } from "./graph"` callers keep working.
export type { GraphData } from "@/lib/graphData";
export type { EntitySearchHit } from "@/types";

// Module-level cache for the raw graph data (used by reports/radar).
// Cache the raw graph data per data-source base (used by reports/radar). A
// preview passes its bundle base ("/api/preview/<sha>/") so radar renders the
// proposed atlas; default is the live atlas under BASE_URL.
const graphCache = new Map<string, Promise<GraphData>>();

export function loadGraph(base: string = liveAtlasBase()): Promise<GraphData> {
  let cached = graphCache.get(base);
  if (!cached) {
    cached = fetchJson<{ entities: GraphEntity[]; edges: RelationEdge[] }>(
      `${base}relations.json`,
      "relations.json",
    ).then((data) => ({
      participants: data.entities.filter(
        (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
      ),
      instances: data.entities.filter((e) => e.et === "instance"),
      invocations: data.entities.filter((e) => e.et === "invocation"),
      primitives: data.entities.filter((e) => e.et === "primitive"),
      edges: data.edges,
    })).catch((err) => {
      graphCache.delete(base);
      // Stale pinned sha → force-forward; return a never-resolving promise so no
      // error UI flashes before the reload swaps in fresh URLs.
      if (handledStale(err)) return new Promise<GraphData>(() => {});
      throw err;
    });
    graphCache.set(base, cached);
  }
  return cached;
}

export interface EdgeResult {
  outbound: ResolvedEdge[];
  inbound: ResolvedEdge[];
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let ready = false;
// Waiters carry a reject arm too: a worker init failure (500/parse on
// relations.json, or a worker-script load error) must settle them with an error
// instead of hanging forever — see failWorker.
const readyCallbacks: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

// Pending callbacks keyed by request id.
const edgePending = new Map<string, (r: EdgeResult) => void>();
const entitySearchPending = new Map<number, (hits: EntitySearchHit[]) => void>();
let entitySearchSeq = 0;

// If the worker dies mid-request the response never arrives, leaking the pending
// callback and hanging the awaiting promise forever. Register every request with
// a timeout that clears the entry and rejects, so callers can recover.
const REQUEST_TIMEOUT_MS = 5000;

function registerPending<K, V>(
  map: Map<K, (v: V) => void>,
  key: K,
  resolve: (v: V) => void,
  reject: (e: Error) => void,
  label: string,
): void {
  const timer = setTimeout(() => {
    map.delete(key);
    reject(new Error(`graph worker ${label} request (${String(key)}) timed out`));
  }, REQUEST_TIMEOUT_MS);
  map.set(key, (v: V) => {
    clearTimeout(timer);
    resolve(v);
  });
}

function getWorker(): Worker {
  if (worker) return worker;

  // Thread the live atlas base via the worker `name` (read as self.name) — same
  // pattern as the atlas/search workers — so the worker fetches the sha-keyed
  // relations.json. Inline `new Worker(new URL(...))` so Vite compiles it.
  const w = new Worker(new URL("../workers/graph.worker.ts", import.meta.url), {
    type: "module",
    name: liveAtlasBase(),
  });
  worker = w;
  // Guard both listeners against a belated event from THIS instance after it's
  // been terminated + replaced (failWorker → respawn): only act while `worker`
  // still points at us, so a late signal from a dead worker can't tear down its
  // successor.
  const isCurrent = () => worker === w;

  w.addEventListener("message", (e: MessageEvent<GraphWorkerOutMessage>) => {
    if (!isCurrent()) return;
    const msg = e.data;

    if (msg.type === "error") {
      // Stale pinned sha (404 on the sha-keyed relations.json) → force-forward.
      if (!handledStaleMessage(msg.message)) {
        console.error("[graph]", msg.message);
        captureException(new Error(msg.message), { mechanism: "graph.worker" });
        // init() failed → the worker will never post "ready". Settle every waiter
        // with the error and drop the worker so the next consumer call respawns a
        // fresh one (a transient 500/network error on relations.json recovers).
        failWorker(new Error(msg.message));
      }
      return;
    }

    if (msg.type === "ready") {
      ready = true;
      for (const cb of readyCallbacks) cb.resolve();
      readyCallbacks.length = 0;
      return;
    }

    if (msg.type === "edges") {
      const cb = edgePending.get(msg.id);
      if (cb) { edgePending.delete(msg.id); cb({ outbound: msg.outbound, inbound: msg.inbound }); }
      return;
    }

    if (msg.type === "search-entities") {
      const cb = entitySearchPending.get(msg.id);
      if (cb) { entitySearchPending.delete(msg.id); cb(msg.hits); }
      return;
    }
  });

  // Worker-script load / uncaught errors never arrive as a message, so the
  // message handler above can't see them — listen directly and fail the same way.
  w.addEventListener("error", (e) => {
    if (!isCurrent() || ready) return; // post-init errors surface via per-request timeouts
    // A worker-script load failure arrives as an opaque event with an EMPTY
    // message (that is what PostHog issue 019fa971 was: an unactionable bare
    // "graph worker error"). Keep the message a STABLE constant so error
    // tracking groups every occurrence into one issue — the variable context
    // (atlas base, which carries the sha) travels as extras, never in the
    // message, where it would fork a fresh issue on every deploy.
    const ev = e as ErrorEvent;
    const err = new Error("graph worker script failed to load");
    console.error("[graph]", err.message);
    captureException(err, {
      mechanism: "graph.worker",
      phase: "init",
      atlas_base: liveAtlasBase(),
      ...(ev.message ? { worker_error: ev.message } : {}),
      ...(ev.filename ? { worker_script: ev.filename } : {}),
      ...(ev.lineno ? { lineno: ev.lineno } : {}),
    });
    failWorker(err);
  });

  return w;
}

// Settle every waiter with the error and drop the worker so the next consumer
// call respawns a fresh one. Without this, a worker init failure leaves
// whenReady() promises pending forever with no retry.
function failWorker(err: Error): void {
  for (const cb of readyCallbacks) cb.reject(err);
  readyCallbacks.length = 0;
  worker?.terminate();
  worker = null;
  ready = false;
}

function whenReady(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => readyCallbacks.push({ resolve, reject }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getEdges(id: string): Promise<EdgeResult> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve, reject) => {
    registerPending(edgePending, id, resolve, reject, "edges");
    w.postMessage({ type: "edges", id });
  });
}

export async function searchEntities(q: string): Promise<EntitySearchHit[]> {
  const w = getWorker();
  await whenReady();
  const id = ++entitySearchSeq;
  return new Promise((resolve, reject) => {
    registerPending(entitySearchPending, id, resolve, reject, "search-entities");
    w.postMessage({ type: "search-entities", id, q });
  });
}
