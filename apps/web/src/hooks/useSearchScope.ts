import { useCallback, useEffect, useState, type RefObject } from "react";
import { useAtlasNodeId } from "./useAtlasNodeId";
import { useDataSource } from "../lib/dataSource";
import { loadDocs } from "../lib/docs";
import { track } from "../lib/analytics";
import { focusInputAt } from "../lib/focusInput";
import { scopeOf, toggleScope, withoutScope } from "../lib/searchScope";
import { ROUTES, homeSearchHref } from "@/lib/routes";

/** The document an `in:` press scopes the search to. */
export interface ScopeDoc {
  docNo: string;
}

/**
 * The document open in the reader, or — once the reader has been left for the
 * results page — the last one opened there, so the scope button can still put
 * back a scope it just removed. Null until a document has been opened.
 */
function useScopeDoc(): ScopeDoc | null {
  const nodeId = useAtlasNodeId();
  const { base } = useDataSource();
  const [doc, setDoc] = useState<ScopeDoc | null>(null);
  useEffect(() => {
    if (!nodeId) return;
    let live = true;
    // The reader has already loaded the bundle, so this resolves from cache.
    loadDocs(base).then(
      (docs) => {
        const node = docs[nodeId];
        if (live && node) setDoc({ docNo: node.doc_no });
      },
      () => {},
    );
    return () => { live = false; };
  }, [nodeId, base]);
  return doc;
}

interface Args {
  query: string;
  location: string;
  navigate: (to: string) => void;
  setQuery: (q: string | null) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The search bar's `in:` button: which document it scopes to, whether the query
 * is scoped now, and the press handler. A press away from the results page
 * carries the scoped query there, as typing in the bar does.
 */
export function useSearchScope({ query, location, navigate, setQuery, inputRef }: Args) {
  const scopeDoc = useScopeDoc();
  const scoped = scopeOf(query);

  // With no document to scope to, a press can still lift a scope the query
  // arrived with (a shared or recent `in:` search).
  const toggle = useCallback(() => {
    if (!scopeDoc && !scoped) return;
    const toggled = scopeDoc ? toggleScope(query, scopeDoc.docNo) : withoutScope(query);
    // A trailing space after an added token, so the reader types straight on.
    const next = scopeOf(toggled) ? `${toggled} ` : toggled;
    track("search_scope_toggle", { product: "search", doc_no: scopeDoc?.docNo ?? scoped, scoped: scopeOf(next) !== null });
    if (location === ROUTES.HOME) setQuery(next || null);
    else navigate(homeSearchHref(next, new URLSearchParams(window.location.search).get("split")));
    focusInputAt(inputRef);
  }, [scopeDoc, scoped, query, location, navigate, setQuery, inputRef]);

  return { scopeDoc, scoped, toggleScope: toggle };
}
