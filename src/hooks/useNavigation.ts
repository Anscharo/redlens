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
      // Keep subset filters active across doc clicks: opening a doc from a
      // filtered list should stay filtered, not jump to All.
      const subset = currentParam("subset");
      if (subset) params.set("subset", subset);
      navigate(`${ROUTES.ATLAS}?${params}`);
    },
    [navigate],
  );

  const handleViewChange = useCallback(
    (v: "annotations" | "glossary" | "history") => {
      track("atlas_view_tab", { node_id: nodeId, view: v });
      const params = new URLSearchParams();
      if (nodeId) params.set("id", nodeId);
      // History is the default tab, so it rides the URL with no ?view= param.
      if (v !== "history") params.set("view", v);
      const split = currentParam("split");
      if (split) params.set("split", split);
      const subset = currentParam("subset");
      if (subset) params.set("subset", subset);
      navigate(`${ROUTES.ATLAS}?${params}`);
    },
    [navigate, nodeId],
  );

  return { navigateToNode, handleViewChange };
}
