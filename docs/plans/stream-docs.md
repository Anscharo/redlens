# Stream‑Docs Plan

## 1.  Goals

1. **Fast first paint** – show all depth‑1 nodes immediately after the file starts streaming.
2. **Bandwidth‑friendly** – only one HTTP GET per Atlas update.
3. **Minimal UI churn** – update the sidebar only once per *batch* (a handful of nodes).
4. **No worker leaks** – terminate the worker cleanly when the component unmounts or a refresh is requested.
5. **Robustness** – graceful handling of network errors and offline fallback.

## 2.  Architecture

```
UI (React) ──►  Atlas Worker ──►  fetch(docs.ndjson) ──►  line splitter
```

* The worker is the sole consumer of `docs.ndjson`.
* The worker streams the file using `fetch(...).body` → `TextDecoderStream()` → newline splitter → `JSON.parse()` per line.
* No streaming JSON parser library needed.
* Batches of nodes are sent to the UI via `postMessage`.

## 3.  File Format Change: docs.json → docs.ndjson

`build-index.mjs` changes in two ways:

1. **Depth sort** – before writing, stable-sort the nodes by `depth` ascending:
   `Object.values(docs).sort((a, b) => a.depth - b.depth)`. Nodes at the same depth retain
   document order. This ensures the file starts with all 7 depth-1 nodes, then depth-2, etc. —
   a prerequisite for fast first paint and for the depth-change batch trigger.

2. **NDJSON output** – write one JSON object per line instead of a single wrapped object.
   `atlasCommit` is embedded on every line so each line is self-describing:

```
{"atlasCommit":"a1b2c3","id":"<uuid>","doc_no":"A.1","depth":1,"title":"...","type":"Scope",...}
{"atlasCommit":"a1b2c3","id":"<uuid>","doc_no":"A.1.1","depth":2,"title":"...","type":"Article",...}
...
```

The output file is `public/docs.ndjson`. All references to `docs.json` in workers, hooks, and
`build-manifest.mjs` must be updated to `docs.ndjson`.

## 4.  Batch Logic

| Trigger | Condition | Action |
|---------|-----------|--------|
| **Size** | 200 nodes | Flush immediately |
| **Depth change** | Next node has a different `depth` | Flush before adding the next node |
| **Idle timeout** | No new node for 200 ms | Flush any partially‑filled batch |

* **Batch size** – 200 nodes.
* **Timeout** – 200 ms.
* **Depth ordering guarantee** – because `build-index.mjs` now writes nodes depth-sorted,
  the depth‑change rule guarantees each batch contains nodes from a single depth level. This
  also means `docNoToId` is fully populated for depth N before any depth N+1 node arrives,
  making incremental `byParent` updates correct.

## 5.  Worker Code (excerpt)

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

// Streaming fetch + line split
const response = await fetch(`${BASE}docs.ndjson`);
const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += value;
  const lines = buf.split("\n");
  buf = lines.pop()!;
  for (const line of lines) {
    if (line) handleNode(JSON.parse(line));
  }
}
if (buf) handleNode(JSON.parse(buf));
flushBatch();
```

## 6.  Message Protocol

```ts
// Batch message — arrives during streaming, one per depth level (or 200-node chunk)
{ type: 'batch', nodes: AtlasNode[] }

// Final ready message — sent after streaming completes
{
  type: 'ready',
  atlasCommit: string,
  docs: Record<string, AtlasNode>,
  byParentEntries: [string | null, AtlasNode[]][],
  docNoToIdEntries: [string, string][],
}

// Error
{ type: 'error', message: string }
```

Maps are serialized as entry arrays (`byParentEntries`, `docNoToIdEntries`) because `Map` is not
transferable via `postMessage`.

## 7.  UI Integration

* Instantiate the worker on mount and terminate on unmount.
* For each `batch` message, merge the nodes into the local `docs` map and update `byParent` /
  `docNoToId` incrementally. Because nodes arrive BFS-sorted, parents are always present before
  children, so `resolveParentId` lookups are always valid.
* When the `ready` message arrives, replace the entire state with the authoritative version.
* Use a virtualized list (`react-window`) to render only visible nodes.

## 8.  Error & Offline Handling

* On `error` – display a toast and offer a retry button that restarts the worker.
* If the fetch fails but a cached `docs.ndjson` is available (Service‑Worker cache), the worker
  will still stream that cached file.

## 9.  Tests

1. **Unit** – mock a `ReadableStream` containing a small NDJSON payload. Verify that:
   * Batches contain only one depth level (given BFS-sorted input).
   * Size / depth / timeout triggers flush correctly.
2. **Integration** – run a headless test with the real `docs.ndjson` (~5 MB). Assert that:
   * The first batch (depth‑1, 7 nodes) is received within 200 ms of starting the worker.
   * The total streaming time is ≤ 1 s.
   * No more than `ceil(totalNodes / 200)` batch messages are sent.
3. **Performance** – measure peak memory usage of the worker (should stay under a few MB).
4. **Reproducibility** – `build-manifest.mjs` must include `docs.ndjson`; `REPRO=1 pnpm test`
   must pass (BFS sort must be stable).

## 10.  Future Enhancements

* **Dynamic batch size** – allow the UI to request a smaller or larger batch if needed.
* **Progress updates** – add an optional `progress` message with `(currentDepth, processedCount)` for a loading bar.
* **Graceful shutdown** – expose a `terminate` API that the UI can call to abort an ongoing stream.

---

> *This plan captures the BFS-sort + NDJSON batching strategy and will be used to implement the streaming worker and UI integration.*
