# Stream‑Docs Plan

## 1.  Goals

1. **Fast first paint** – show all depth‑1 nodes immediately after the file starts streaming.
2. **Bandwidth‑friendly** – only one HTTP GET per Atlas update.
3. **Minimal UI churn** – update the sidebar only once per *batch* (a handful of nodes).
4. **No worker leaks** – terminate the worker cleanly when the component unmounts or a refresh is requested.
5. **Robustness** – graceful handling of network errors and offline fallback.

## 2.  Architecture

```
UI (React) ──►  Atlas Worker ──►  fetch(docs.json) ──►  jsonriver
```

* The worker is the sole consumer of `docs.json`.
* The worker streams the file using `fetch(...).body` → `TextDecoderStream()` → `jsonriver.parse()`.
* Batches of nodes are sent to the UI via `postMessage`.

## 3.  Batch Logic

| Trigger | Condition | Action |
|---------|-----------|--------|
| **Size** | 200 nodes | Flush immediately |
| **Depth change** | Next node has a different `depth` | Flush before adding the next node |
| **Idle timeout** | No new node for *X* ms | Flush any partially‑filled batch |

* **Batch size** – 200 nodes (chosen to keep IPC traffic low while still giving the UI a fine granularity).
* **Timeout** – 200 ms (reasonable on modern networks; can be tuned if necessary).
* **Depth‑first ordering guarantee** – the server already writes the JSON breadth‑first (depth‑1 first, then depth‑2, …). `jsonriver` emits nodes in that order, so the worker’s depth‑change rule guarantees each batch contains nodes from a single depth level.

## 4.  Worker Code (excerpt)

```ts
const BATCH_SIZE = 200;
const BATCH_TIMEOUT_MS = 200;

let currentDepth: number | null = null;
let batch: AtlasNode[] = [];
let timeoutId: number | null = null;

function flushBatch() {
  if (batch.length) {
    postMessage({ type: 'batch', nodes: batch });
    batch = [];
  }
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function maybeStartTimeout() {
  if (timeoutId === null) {
    timeoutId = setTimeout(() => flushBatch(), BATCH_TIMEOUT_MS) as any;
  }
}

function handleNode(node: AtlasNode) {
  if (currentDepth === null) currentDepth = node.depth;

  if (node.depth !== currentDepth) {
    flushBatch();
    currentDepth = node.depth;
  }

  batch.push(node);
  if (batch.length >= BATCH_SIZE) flushBatch();
  maybeStartTimeout();
}
```

The rest of the worker follows the existing pattern: fetch, pipe through `TextDecoderStream`, `jsonriver`, and at the end emit a `ready` message containing the fully built `AtlasBundle`.

## 5.  Message Protocol

```ts
// Batch message
{ type: 'batch', nodes: AtlasNode[] }

// Final ready message
{ type: 'ready', atlasCommit: string, docs: Record<string, AtlasNode>, byParent: Map<string | null, AtlasNode[]>, docNoToId: Map<string, string> }

// Error
{ type: 'error', message: string }
```

The UI only needs to handle these three message types.

## 6.  UI Integration

* Instantiate the worker on mount and terminate on unmount.
* For each `batch` message, merge the nodes into the local `docs` map and update `byParent` / `docNoToId` incrementally.
* When the `ready` message arrives, replace the entire state.
* Use a virtualized list (`react-window` / `react-virtualized`) to render only visible nodes.

## 7.  Error & Offline Handling

* On `error` – display a toast and offer a retry button that restarts the worker.
* If the fetch fails but a cached `docs.json` is available (Service‑Worker cache), the worker will still stream that cached file.

## 8.  Tests

1. **Unit** – mock a `ReadableStream` containing a small JSON payload.  Verify that:
   * Batches contain only one depth level.
   * Size / depth / timeout triggers flush correctly.
2. **Integration** – run a head‑less test with the real `docs.json` (~30 MB).  Assert that:
   * The first batch (depth‑1) is received within 200 ms of starting the worker.
   * The total streaming time is ≤ 2 s.
   * No more than `ceil(totalNodes / 200)` batch messages are sent.
3. **Performance** – measure peak memory usage of the worker (should stay under a few MB).

## 9.  Future Enhancements

* **Dynamic batch size** – allow the UI to request a smaller or larger batch if needed.
* **Progress updates** – add an optional `progress` message with `(currentDepth, processedCount)` for a loading bar.
* **Graceful shutdown** – expose a `terminate` API that the UI can call to abort an ongoing stream.

---

> *This plan captures the breadth‑first batching strategy described in the discussion and will be used to implement the streaming worker and UI integration.*
