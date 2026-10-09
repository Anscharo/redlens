import { useCallback } from "react";
import { useLocation } from "wouter";
import { ROUTES } from "@/lib/routes";
import { useAtlasNodeId } from "../../hooks/useAtlasNodeId";
import { useNavigateToNode } from "../../hooks/useNavigation";
import { useSplitPane } from "../../hooks/useSplitPane";
import { Drawer } from "../Drawer";
import { ErrorBoundary, PanelError } from "../ErrorBoundary";
import { TreeSidebar } from "./TreeSidebar";

const TREE_ROUTES: ReadonlySet<string> = new Set([ROUTES.HOME, ROUTES.ATLAS, ROUTES.SEARCH_HINTS]);

export interface TreeDrawerProps {
  /** Whether the drawer is open on narrow screens; wide screens always show the sidebar. */
  open: boolean;
  /** Closes the drawer. Picking a document closes it too. */
  onClose: () => void;
}

/** The atlas tree sidebar, on the routes that show it: a resizable column on
 *  wide screens, a drawer on narrow ones. Click opens a document in the
 *  reader; shift-click opens it in the comparison pane. */
export function TreeDrawer({ open, onClose }: TreeDrawerProps) {
  const [location] = useLocation();
  const nodeId = useAtlasNodeId();
  // The tree only opens documents, so it takes the navigator alone rather
  // than useNavigation, whose other half switches the reader's panel.
  const navigateToNode = useNavigateToNode();
  const { handleSplitChange } = useSplitPane(nodeId);
  const handleNavigate = useCallback(
    (id: string) => {
      navigateToNode(id);
      onClose();
    },
    [navigateToNode, onClose],
  );

  if (!TREE_ROUTES.has(location)) return null;
  return (
    <ErrorBoundary fallback={(error) => <PanelError error={error} />}>
      <Drawer
        open={open}
        onClose={onClose}
        defaultWidth={280}
        resizable
        minWidth={180}
        maxWidth={600}
        storageKey="redline-sky-atlas:tree-sidebar-width"
      >
        <TreeSidebar nodeId={nodeId} onNavigate={handleNavigate} onShiftNavigate={handleSplitChange} />
      </Drawer>
    </ErrorBoundary>
  );
}
