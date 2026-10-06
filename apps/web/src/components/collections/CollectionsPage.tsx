import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { urlEnum, useUrlState } from "../../hooks/useUrlState";
import { COLLECTIONS_VIEWS, CollectionsViewToggle, type CollectionsView } from "./CollectionsViewToggle";
import { ConversationCollections } from "./ConversationCollections";
import { MyCollections } from "./MyCollections";

const viewCodec = urlEnum<CollectionsView>("mine", COLLECTIONS_VIEWS);

// /collections — a signed-in user's saved document selections, plus the auto
// collections their conversations built (`?view=conversations`). Sign-in gated
// (this app has no route-level auth gate; every page gates itself).
export function CollectionsPage() {
  useDocumentTitle("Collections");
  const { user } = useAuth();
  const [view, setView] = useUrlState("view", viewCodec);

  return (
    <div className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">collections</p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: "var(--tan)" }}>
          Your Collections
        </h1>

        {!user ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <h2 className="text-sm font-medium" style={{ color: "var(--tan)" }}>
              Sign in to view your collections
            </h2>
            <div className="w-64">
              <SignInButtons variant="menu" source="collections" />
            </div>
          </div>
        ) : (
          <>
            <CollectionsViewToggle active={view} onChange={setView} />
            {view === "mine" ? <MyCollections /> : <ConversationCollections />}
          </>
        )}
      </div>
    </div>
  );
}
