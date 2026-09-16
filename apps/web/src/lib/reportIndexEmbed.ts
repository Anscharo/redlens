// Lazy ternlight loader for /reports index search. Dynamic import so the
// ~7 MB wasm is a separate chunk, fetched only when the index is queried —
// browse-only visits never pay for it. A load failure degrades to lexical
// matching (the same fallback the chat's similarity lane uses).
//
// Vite 8.0 cannot instantiate WASM ESM imports (`import * as wasm from
// "./x.wasm"`), which is what `@ternlight/base`'s default/browser entry uses
// (pkg-bundler). The `/web` subpath is wasm-pack's fetch target: we call
// `init()` with a Vite-emitted asset URL (`new URL(..., import.meta.url)` in
// *this* file, so Vite rewrites it) and then `embed()`.
import { REPORT_INDEX_CARDS } from "@/lib/reportCatalog";
import {
  buildReportFieldVecs,
  cosineSim,
  scoreReportQuery,
  type EmbedFn,
} from "@/lib/reportIndexSearch";

type Embedder = {
  embed: EmbedFn;
  fieldVecs: Map<string, Float32Array[]>;
};

let loading: Promise<Embedder | null> | null = null;

export function loadReportIndexEmbedder(): Promise<Embedder | null> {
  if (!loading) {
    loading = import("@ternlight/base/web")
      .then(async ({ default: init, embed }) => {
        const wasmUrl = new URL(
          "../../node_modules/@ternlight/base/pkg-web/tern_engine_bg.wasm",
          import.meta.url,
        );
        await init({ module_or_path: wasmUrl });
        return {
          embed,
          fieldVecs: buildReportFieldVecs(REPORT_INDEX_CARDS, embed),
        };
      })
      .catch((err: unknown) => {
        console.error("[reports] @ternlight/base failed to load — lexical-only search:", err);
        return null;
      });
  }
  return loading;
}

export function scoreReportIndex(embedder: Embedder, query: string): Map<string, number> {
  return scoreReportQuery(query, embedder.fieldVecs, embedder.embed, cosineSim);
}
