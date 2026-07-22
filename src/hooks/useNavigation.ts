import { useCallback } from "react";
import { ROUTES } from "../lib/routes";
import { track } from "../lib/analytics";

// Read a param from the live URL at click time so it rides along on every
// atlas-internal navigation (split stays open, active tab stays active).
function currentParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function useNavigation({
  navigate,
  nodeId,
}: {
  navigate: (to: string) => void;
  nodeId: string | null;
}) {
  const navigateToNode = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      params.set("id", id);
      const split = currentParam("split");
      if (split) params.set("split", split);
      const view = currentParam("view");
      if (view) params.set("view", view);
      // Keep the selected-only filter active across doc clicks: opening a doc
      // from the filtered list should stay in selected view, not jump to All.
      const selectedOnly = currentParam("selectedOnly");
      if (selectedOnly) params.set("selectedOnly", selectedOnly);
      navigate(`${ROUTES.ATLAS}?${params}`);
    },
    [navigate],
  );

  const handleViewChange = useCallback(
    (v: "annotations" | "glossary" | "history") => {
      track("atlas_view_tab", { node_id: nodeId, view: v });
      const params = new URLSearchParams();
      if (nodeId) params.set("id", nodeId);
      if (v !== "annotations") params.set("view", v);
      const split = currentParam("split");
      if (split) params.set("split", split);
      const selectedOnly = currentParam("selectedOnly");
      if (selectedOnly) params.set("selectedOnly", selectedOnly);
      navigate(`${ROUTES.ATLAS}?${params}`);
    },
    [navigate, nodeId],
  );

  return { navigateToNode, handleViewChange };
}
