import { useMemo } from "react";
import { Breadcrumbs } from "../Breadcrumbs";
import { Loading } from "../Loading";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { AtlasReader } from "./AtlasReader";
import { AtlasAnnotations } from "./AtlasAnnotations";
import { DrawerToggle } from "../Drawer";
import { useAtlasData } from "../../hooks/useAtlasData";
import { useAtlasSelection } from "../../hooks/useAtlasSelection";
import { useNodeAnnotations } from "../../hooks/useNodeAnnotations";
import {
  buildAncestorsWithSelf,
  ATLAS_GRID_STYLE,
} from "../../lib/atlasHelpers";

export function AtlasView({
  id,
  onNavigate,
  view,
  onViewChange,
  splitId,
  onSplitChange,
  onOpenTree,
}: {
  id: string;
  onNavigate: (id: string) => void;
  view: "annotations" | "glossary" | "history";
  onViewChange: (v: "annotations" | "glossary" | "history") => void;
  splitId: string | null;
  onSplitChange: (id: string | null) => void;
  onOpenTree?: () => void;
}) {
  const data = useAtlasData();
  const { selectedId, handleNavigate } = useAtlasSelection(id, onNavigate);
  const { linkedNodes, targetAddresses, chainValues, glossaryTerms } = useNodeAnnotations(id, data);

  const ancestors = useMemo(() => {
    if (!data || !id) return [];
    return buildAncestorsWithSelf(data.atlas.docs, data.atlas.docNoToId, id);
  }, [data, id]);

  if (!data) {
    return <Loading />;
  }
  if (id && !data.atlas.docs[id]) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-red">
        Node not found: {id}
      </div>
    );
  }

  const addressCount = Object.keys(targetAddresses).length;
  const annotationCount = linkedNodes.length + addressCount;

  return (
    <AtlasActionsContext.Provider value={{ navigate: handleNavigate, toggle: () => {}, splitNavigate: onSplitChange }}>
      <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-center" style={{ borderBottom: "1px solid var(--border)" }}>
          <DrawerToggle label="Atlas" onClick={onOpenTree} breakpoint={1050} />
          {id && <Breadcrumbs ancestors={ancestors} />}
        </div>
        <div className="flex-1 flex" style={ATLAS_GRID_STYLE}>
          <AtlasReader
            id={id}
            selectedId={selectedId}
            splitId={splitId}
            onSplitChange={onSplitChange}
            data={data}
          />
          {id && (
            <AtlasAnnotations
              id={id}
              linkedNodes={linkedNodes}
              targetAddresses={targetAddresses}
              chainValues={chainValues}
              glossaryTerms={glossaryTerms}
              annotationCount={annotationCount}
              tab={view}
              onTabChange={onViewChange}
              onNavigate={onNavigate}
              onNavigateByDocNo={(docNo) => {
                const uuid = data.atlas.docNoToId.get(docNo);
                if (uuid) onNavigate(uuid);
              }}
            />
          )}
        </div>
      </div>
    </AtlasActionsContext.Provider>
  );
}
