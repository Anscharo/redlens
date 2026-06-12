# AtlasView refactor — hooks, context, component splits

## Context

`AtlasView.tsx` is 382 lines and does too many things: loads data, computes per-node annotations,
manages left-pane expand/scroll/toggle state, renders both panes, wires up a resize handle.
`pr-ready-refactor-prompt.md` is COMPLETED — all prerequisites are met.

This is a structural-only refactor. No behaviour changes, no visual changes, no new dependencies.
MUST NOT touch `src/index.css`, the build pipeline, `package.json`, or atlas data.

---

## Architecture target

```
AtlasView                          ← data loading + cross-cutting state + layout shell
  useAtlasData()                   → data
  useAtlasSelection(id, onNav)     → selectedId, handleNavigate
  useNodeAnnotations(id, data)     → linkedNodes, targetAddresses, chainValues, glossaryTerms
  useGraphEdges(id)                → graphEdges  (or move inside RightPanel — see commit 3)
  ancestors useMemo                → stays (feeds Breadcrumbs)

  <AtlasActionsContext>            ← stable callbacks: navigate, toggle, splitNavigate
    <Breadcrumbs />
    <AtlasReader id data selectedId />      ← owns expand/toggle/scroll state + docList
    <AtlasAnnotations id data ... />        ← resize handle + RightPanel wrapper
```

---

## Commits — work in this order

### Commit 1 — `AtlasActionsContext`: pull stable callbacks out of props

`onNavigate` (`handleNavigate`), `onToggle` (`handleToggle`), and `onShiftNavigate`
(`onSplitChange`) are stable `useCallback` values that today thread through the `docList`
useMemo as dep-array entries and as props on every `CollapsibleNode`. Putting them in context:

- Removes 3 props from `CollapsibleNode` (and from the `docList` loop)
- Removes those 3 from the `docList` dep array — the memo is now immune to callback identity
- Extends naturally to `NodeContent`, which already consumes an `onNavigate` context

**New file:** `src/components/atlas/AtlasActionsContext.tsx`

```ts
interface AtlasActions {
  navigate: (id: string) => void;
  toggle: (id: string) => void;
  splitNavigate: (id: string) => void;
}
export const AtlasActionsContext = createContext<AtlasActions | null>(null);
export function useAtlasActions(): AtlasActions { ... }  // throws if no provider
```

**`AtlasView`:** wrap the return in `<AtlasActionsContext.Provider value={{ navigate: handleNavigate, toggle: handleToggle, splitNavigate: onSplitChange }}>`. Remove the three props from the `docList` loop and its dep array.

**`CollapsibleNode`:** consume `useAtlasActions()` instead of receiving `onNavigate`, `onToggle`,
`onShiftNavigate` as props. Remove those from the props interface.

`selectedId` stays a prop — context bypasses `memo()`, so putting it in context would make all
1200 nodes re-render on selection change, reversing the lag fix.

Commit subject: `feat: AtlasActionsContext — pull navigate/toggle/split out of CollapsibleNode props`

---

### Commit 2 — Extract custom hooks

Extract these from `AtlasView` into `src/hooks/` (or `src/components/atlas/` if atlas-specific):

| Hook | Wraps | File |
|---|---|---|
| `useAtlasData()` | Promise.all load + setData | `src/hooks/useAtlasData.ts` |
| `useAtlasSelection(id, onNavigate)` | selectedId state + mirror effect + handleNavigate | `src/hooks/useAtlasSelection.ts` |
| `useNodeAnnotations(id, data)` | linkedNodes/addresses/chainValues/glossaryTerms memo (includes glossaryLookup internally) | `src/hooks/useNodeAnnotations.ts` |
| `useGraphEdges(id)` | graphEdges state + cancellable fetch | `src/hooks/useGraphEdges.ts` |
| `useAtlasScroll(id, data, expandedParents)` | scrolledRef + two scroll effects | `src/components/atlas/useAtlasScroll.ts` |

`AtlasView` after this commit becomes a thin coordinator: a handful of hook calls, a few
remaining memos (`ancestors`, `expandedSet`, `docList`), and the render.

Commit subject: `refactor: extract useAtlasData/Selection/NodeAnnotations/GraphEdges/Scroll`

---

### Commit 3 — Extract `AtlasReader` (left pane)

Pull the entire left-pane into `src/components/atlas/AtlasReader.tsx`. Crucially, the state
that is only ever used by the left pane moves **into** `AtlasReader` — it does not stay in
`AtlasView` as pass-through props:

State / logic that moves into `AtlasReader`:
- `userToggles`, `handleToggle` (already in context after commit 1, but the state lives here)
- `seenExpanded` ref, `expandedSet` useMemo
- `useDepth6Expand` → `expandedParents`, `hiddenCount`, `expandParent`
- `scrollContainerRef`, `scrolledRef`, `useAtlasScroll`
- `useExpandingAttr`, `handleExpandParent`
- `docList` useMemo (it only feeds the left pane)

Props `AtlasReader` receives from `AtlasView`:
- `id: string`
- `selectedId: string | null`
- `splitId: string | null`
- `onSplitChange: (id: string | null) => void`
- `data: LoadedData`

`AtlasActionsContext` (from commit 1) means `onNavigate`, `onToggle`, `onShiftNavigate` are
not props — `AtlasReader` reads them from context internally where needed.

Commit subject: `refactor: extract AtlasReader — left pane owns its own expand/scroll state`

---

### Commit 4 — Extract `AtlasAnnotations` (right pane wrapper)

Pull the right-pane wrapper into `src/components/atlas/AtlasAnnotations.tsx`:
- The `rightWidth` state + `useResizeDrag` call
- The resize handle `<div>`
- The `ErrorBoundary` + `RightPanel` with all its props

`graphEdges` can move inside `AtlasAnnotations` — it is only consumed by `RightPanel` and
can be fetched locally given `id`.

Props `AtlasAnnotations` receives:
- `id: string`
- `linkedNodes`, `targetAddresses`, `chainValues`, `glossaryTerms`, `annotationCount` (from `useNodeAnnotations` in `AtlasView`)
- `tab`, `onTabChange`
- `onNavigate`, `onNavigateByDocNo` (right panel nav is not latency-sensitive, uses raw `onNavigate`)

Commit subject: `refactor: extract AtlasAnnotations — right pane owns resize + edge fetch`

---

### Commit 5 — Narrow `TreeRow.tsx` non-null assertions

`src/components/tree/TreeRow.tsx` uses `node!.id`. The component already guards with
`if (!item) return null` after hooks, so `node!` is just unfinished narrowing. Fix:

```ts
const item = visibleNodes[index];
const node = item?.node;
// useMemo hooks stay here (hooks must be unconditional)
if (!item || !node) return null;
// drop every node! below — node is AtlasNode here
```

Commit subject: `refactor: narrow node type in TreeRow to drop non-null assertions`

---

## Constraints (all commits)

- MUST NOT change behaviour — identical DOM output, identical event handling
- MUST NOT touch `src/index.css`, `package.json`, `vite.config.ts`, build pipeline, atlas data
- MUST NOT introduce new dependencies
- Max 3 components per file (only if 2 are <8 lines); max ~150 lines per file

## Verification (run after all commits)

1. `pnpm tsc --noEmit` — clean
2. `pnpm dev` — visually confirm: list scrolls/expands/navigates, shift-click split pane,
   right panel tabs, back/forward selection, resize handle all work identically
3. `git diff --stat` — only files in scope appear; no `src/index.css`, no build artifacts
