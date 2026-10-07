import { useCallback } from "react";
import { useLocation } from "wouter";
import { ROUTES } from "@/lib/routes";
import { track } from "../lib/analytics";
import type { AtlasTab } from "../lib/atlasTab";

// Copy params from the live URL at click time so they ride along on every
// atlas-internal navigation (split stays open, active tab stays active).
function carryParams(params: URLSearchParams, keys: string[]): URLSearchParams {
  if (typeof window === "undefined") return params;
  const live = new URLSearchParams(window.location.search);
  for (const key of keys) {
    const value = live.get(key);
    if (value) params.set(key, value);
  }
  return params;
}

type Navigate = (to: string) => void;

/** Opens a node in the reader. Subset filters stay active across doc clicks:
 *  opening a doc from a filtered list stays filtered rather than jumping to All. */
function useNodeNavigator(navigate: Navigate): (id: string) => void {
  return useCallback(
    (id: string) => navigate(`${ROUTES.ATLAS}?${carryParams(new URLSearchParams({ id }), ["split", "view", "subset"])}`),
    [navigate],
  );
}

/** Switches the reader's right panel. Notes is the default panel, so it rides the URL with no ?view= param. */
function useViewChange(navigate: Navigate, nodeId: string | null): (v: AtlasTab) => void {
  return useCallback(
    (v: AtlasTab) => {
      track("atlas_view_tab", { node_id: nodeId, view: v });
      const params = new URLSearchParams();
      if (nodeId) params.set("id", nodeId);
      if (v !== "notes") params.set("view", v);
      navigate(`${ROUTES.ATLAS}?${carryParams(params, ["split", "subset"])}`);
    },
    [navigate, nodeId],
  );
}

export function useNavigation({ navigate, nodeId }: { navigate: Navigate; nodeId: string | null }) {
  return { navigateToNode: useNodeNavigator(navigate), handleViewChange: useViewChange(navigate, nodeId) };
}

/** navigateToNode for a component that links into the atlas from outside the
 *  reader, such as a report's expanded row, so the route need not pass it down. */
export function useNavigateToNode(): (id: string) => void {
  const [, navigate] = useLocation();
  return useNodeNavigator(navigate);
}
