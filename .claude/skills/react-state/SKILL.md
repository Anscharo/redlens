---
name: react-state
description: >
  How to decide where React state lives in RedLens and how to expose it —
  local vs URL vs context vs external store vs worker/loader data. Use when
  adding state to a component, lifting or colocating state, choosing between
  useState and useUrlState, adding a context provider, wiring
  useSyncExternalStore, designing a component's value + callback props, or
  fixing re-render, derived-state or stale-state bugs.
  Keywords: state, useState, useReducer, controlled component, callback prop,
  lifting state up, prop
  drilling, custom hook, context, createContext, provider, useUrlState, URL
  state, query param, useSyncExternalStore, localStorage, useMemo,
  useCallback, memo, useEffect, derived state, stale state, re-render,
  data-state, workers, useLoaded, data fetching.
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# Managing Component State

This skill is about choosing the **narrowest place** state can live in RedLens, and making
that state visible to CSS and to tests. Where [components.build](https://www.components.build)
and RedLens practice disagree — notably on controlled/uncontrolled dual mode (§2) — the house
pattern wins and the divergence is called out explicitly.

Pairs with the **`react-components`** skill (composition, props, accessibility, data attributes).

## 1. The placement ladder

Walk it top to bottom and stop at the first rung that works. Every rung down costs
re-renders, test setup, and a way to get out of sync.

**0. Don't store it.** If a value can be computed from props or existing state, compute it.
Derived state duplicated into `useState` + `useEffect` is the most common bug in this
codebase's shape of code. RedLens uses exactly one `useReducer`, and only as a force-render
bump (`src/components/AddressTooltip.tsx`) — that is the intended rarity.

**1. Local `useState`.** Default for anything one subtree owns: hover, open/closed, draft input.

**2. URL state — `useUrlState`** (`src/hooks/useUrlState.ts`). Use this whenever the state is
something a user would reasonably **bookmark, share, or reach with the back button**: the
selected tab, an active filter, a query, a selected node. This is the house default for report
and view state, not `useState`.

```tsx
const [mode, setMode] = useUrlState("mode", urlEnum("broad", ["broad", "phrase"] as const));
```

Codecs live beside it: `urlString`, `urlInt`, `urlBool`, `urlEnum`, `urlEnumList`,
`urlTagged` (kind.slug), `urlStringSet` — note the argument order is
`urlEnum(default, allowed)`. It **replaces** history by default; pass
`{ push: true }` only for real navigations. Reports have wrappers —
`useReportQuery` / `useReportView` / `useReportFilter` in
`src/components/reports/useReportQuery.ts`; use those on report routes, and note the in-file
rule: **never call `track("report_filter")` directly**, go through `trackReportFilter`.

**3. Context** — for configuration or selection shared by a whole subtree that has no business
in the URL. Nine exist: `DataSourceContext`, `SelectionContext`, `ChatOpenContext`,
`AuthContext`, `PreviewDiffContext`, `PreviewViewContext`, `AtlasActionsContext`, `RadarCtx`,
`NavigateContext`. The local convention:

- Export the context value **type** as an interface.
- Co-locate the consumer hook `useX()` in the same file.
- That hook either **throws** when the provider is missing
  (`src/components/atlas/AtlasActionsContext.tsx`) or returns a documented NOOP default
  (`src/lib/selection.tsx`, `src/lib/dataSource.tsx`). Pick one deliberately: throw when the
  component is meaningless without the provider, default when it must degrade.
- Keep the provider value stable (`useMemo`) — a fresh object literal re-renders every consumer.

**4. External store — `useSyncExternalStore`.** This replaces a state library for
cross-tree, storage-backed state. Four sites: `src/lib/visitHistory.ts`,
`src/lib/recentSearches.ts`, `src/lib/hintStore.ts`, `src/components/chat/usePrefs.ts`.
**The snapshot function must return a referentially stable value** — returning a fresh
array/object each call causes an infinite render loop. Both `recentSearches.ts` and
`usePrefs.ts` carry in-file warnings about exactly this; read one before adding a fifth store.

There is no zustand/redux/jotai/react-query in this repo. Don't introduce one.

**5. Async/remote data — `useLoaded`** (`src/hooks/useAtlasData.ts`). Never fetch atlas
artifacts by hand in a component. `useLoaded(loader, { soft? })` takes a module-level cached
promise (`loadDocs`, `loadGraph`, `loadAtlas`, `loadGlossary`, `loadAddresses`,
`loadChainState`, `loadHistoryBatch`) and **re-throws on rejection during render** so the
nearest `ErrorBoundary` catches it. Pass `{ soft: true }` only for enrichment that the page can
render without.

Every loader resolves its `base` from `useDataSource()`, which is what lets the same components
serve live (`/api/atlas/<sha>/`) and preview (`/api/preview/<sha>/`) with no forked views.

**6. Worker-owned state.** Search (`search.worker.ts`), the docs tree (`atlas.worker.ts`), and
the relations graph (`graph.worker.ts`) own their own indexes; components talk to them through
`useSearch`, `useAtlasData`, and `useGraphEdges` — reuse the existing hooks rather than standing
up a new worker consumer.
Load-bearing and easy to break:
`new Worker(new URL("...", import.meta.url), { type: "module", name: base })` must stay
**inline** or Vite won't compile the worker, and the data-source base travels in the worker
`name` (read as `self.name`), never a query param.

## 2. Components are controlled; the page owns the state

The spec recommends every input-like component support **both** controlled and uncontrolled
use, merged with Radix's `useControllableState`. **RedLens deliberately does not do this** —
and new components should follow the house pattern, not the spec here.

The house pattern is **fully controlled, with domain-named callbacks**. State lives in the
page (usually in the URL); components receive the current value and report intent upward:

```tsx
export function ScopePills({
  filter,
  onToggle,
}: {
  filter: ActiveFilter;
  onToggle: (next: EntityFilter) => void;
}) { /* … */ }
```

Measured practice: **zero** `defaultValue` props, **zero** `onValueChange`, and no dual-mode
component anywhere. Callbacks are named for what they mean — `onNavigate`, `onToggle`,
`onClose`, `onSelect`, `onMark`/`onUnmark` — not for the generic value they carry. Keep that
vocabulary.

Do **not** introduce `value`/`defaultValue`/`onValueChange` trios, and do **not** add
`@radix-ui/react-use-controllable-state`; it is not a dependency, and any dependency change
must ship the refreshed **`pnpm-lock.yaml` in the same commit** or `pnpm install
--frozen-lockfile` fails CI and the Docker build.

The one rule from the spec that still binds, because it is a real bug class:

- **Don't copy a prop into `useState`.** If the parent owns the value, read it from props.
  Mirroring it into local state is how the two get out of sync.

## 3. Make state visible to CSS, not to JS branches

Reflect state on the DOM as a data attribute and let the stylesheet react:

```tsx
<button data-active={active ? "true" : undefined} className="scope-pill" />
```

Prefer the shared `data-state` vocabulary for new components (`open`/`closed`,
`active`/`inactive`), plus `data-disabled`, `data-loading`, `data-orientation`, `data-side`.
Existing components use a dozen-plus ad-hoc attributes (`data-active`, `data-open`, `data-hot`, …) whose
selectors are wired into `index.css` — leave those alone. Per `CLAUDE.md`: *don't add hover/click logic in JS when CSS
will do it.* This also gives tests and DevTools a stable thing to assert on. Full
naming rules are in the `react-components` skill.

## 4. Effects, memoization, re-renders

- **An effect is for synchronising with something outside React** — a subscription, a worker,
  the document title, an analytics event. It is not for computing state from props.
- **Always clean up**: listeners, timers, worker handlers, aborts.
- **Dependency arrays must be honest.** `oxlint` runs the React plugin (`pnpm lint`) and flags
  missing deps, hooks called outside the top level, missing `key`s, array-index keys, and
  components defined inside components (which remounts the whole subtree every render).
- **Memoize derived rows, not everything.** The local pattern: `useMemo` for derived collections
  (`ActiveDataReport.tsx` memoizes each derivation stage), `useCallback` for handlers passed to
  memoized children, and `memo()` reserved for components that re-render in bulk —
  chiefly list/result rows (`SearchResult`, `RelatedNode`, `CollapsibleNode`) and the
  `ModFrequency*` chart suite; there are ~17 sites. Note `TreeRow` is **not** memoized (it is a
  react-window row, which already virtualizes) and `AtlasReader` is a pane rather than a row —
  don't treat the list as exhaustive or as a rule that everything else must match. The house form is
  `export const X = memo(function X({…}: Props) {…})` so the component keeps its name in
  DevTools and stack traces.
- Expensive but interruptible updates can use `useTransition` (`useReportQuery.ts`).

## 5. Testing state

Tests are **co-located** (`Foo.tsx` ↔ `Foo.test.tsx`) and DOM tests opt in with
`// @vitest-environment jsdom` **on line 1** — vitest runs `node` by default here.

- Test through the public surface with `@testing-library/react` + `user-event`: render, act,
  assert on what the user sees, not on internal state.
- Test a controlled component the way it is used: assert it **calls its callback** with the
  right argument, and that it renders the value it was given. It should not change what it
  displays until the parent re-renders it with a new prop.
- Pure logic extracted to `src/lib/` gets its own test with no React at all — that is the whole
  reason it lives there.
- Hooks in `src/hooks/` each have a co-located test; follow the neighbours.
- Shared fixtures live in `src/test/{fixtures,mocks,workerFixtures,workerGlobal}.ts`.

## Definition of done

- [ ] State sits on the lowest viable rung; nothing duplicated that could be derived
- [ ] Shareable/bookmarkable state is in the URL via `useUrlState`, not `useState`
- [ ] New context exports its value type, co-locates `useX()`, and memoizes the provider value
- [ ] Any `useSyncExternalStore` snapshot is referentially stable
- [ ] Remote data goes through `useLoaded` + `useDataSource()`, never a bare `fetch`
- [ ] Components stay fully controlled with domain-named callbacks; no `defaultValue`/`onValueChange` trio; no prop→state copy
- [ ] State reflected as `data-*` for CSS instead of JS class branching
- [ ] Effects clean up; dep arrays honest; `memo` only on list rows
- [ ] Co-located tests assert value-in / callback-out; `// @vitest-environment jsdom` on line 1 for DOM tests
- [ ] `pnpm lint`, `pnpm build:ts`, `pnpm test` pass
