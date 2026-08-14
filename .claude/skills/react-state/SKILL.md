---
name: react-state
description: >
  How to decide where React state lives in RedLens and how to expose it —
  local vs URL vs context vs external store vs worker/loader data — plus the
  components.build controlled/uncontrolled contract. Use when adding state to
  a component, lifting or colocating state, choosing between useState and
  useUrlState, adding a context provider, wiring useSyncExternalStore, adding
  a value/defaultValue/onChange prop pair, fixing re-render or stale-state
  bugs, or reviewing effects and memoization.
  Keywords: state, useState, useReducer, controlled, uncontrolled,
  defaultValue, onValueChange, useControllableState, lifting state up, prop
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

The [components.build](https://www.components.build) rule for state is short: *the best
components support both controlled and uncontrolled use*. Everything else here is about
choosing the **narrowest place** state can live in RedLens, and making that state visible to
CSS and to tests.

Pairs with the **`react-components`** skill (composition, props, accessibility, data attributes).

## 1. The placement ladder

Walk it top to bottom and stop at the first rung that works. Every rung down costs
re-renders, test setup, and a way to get out of sync.

**0. Don't store it.** If a value can be computed from props or existing state, compute it.
Derived state duplicated into `useState` + `useEffect` is the most common bug in this
codebase's shape of code. RedLens uses exactly one `useReducer`, and only as a force-render
bump (`src/components/AddressTooltip.tsx`) — that is the intended rarity.

**1. Local `useState`.** Default for anything one subtree owns: hover, open/closed, draft
input. 78 sites.

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
`useSearch`, `useAtlasData`, and `useGraphEdges`. Load-bearing and easy to break:
`new Worker(new URL("...", import.meta.url), { type: "module", name: base })` must stay
**inline** or Vite won't compile the worker, and the data-source base travels in the worker
`name` (read as `self.name`), never a query param.

## 2. Controlled and uncontrolled

A component is **uncontrolled** when it holds its own state and exposes `defaultValue`;
**controlled** when the parent owns the value and passes `value` + a change callback. The spec
says components should support both — that is what makes them usable in a form, in a URL-driven
page, and standalone.

The prop trio is a naming contract:

```tsx
type StepperProps = {
  /** Controlled value. Presence of this prop switches the component to controlled mode. */
  value?: number;
  /** Initial value in uncontrolled mode. */
  defaultValue?: number;
  /** Called on every change, in both modes. */
  onValueChange?: (value: number) => void;
};
```

Rules that keep both modes honest:

- **`value === undefined` means uncontrolled.** Decide once, on the presence of the prop.
- **Never switch modes mid-life.** A component that starts controlled must stay controlled;
  flipping is the source of "my input went read-only" bugs.
- **`onValueChange` fires in both modes.** Callers must be able to observe changes without
  taking ownership of the value.
- **Don't copy a `value` prop into `useState`.** That is the derived-state bug again.

The spec's recommended implementation is Radix's `useControllableState`
(`{ prop, defaultProp, onChange }` → `[value, setValue]`). It is **not currently a dependency
here**, and adding one means updating **both `pnpm-lock.yaml` and `bun.lock` in the same
commit** — `bun install --frozen-lockfile` fails the Railway Docker build otherwise. For a
single component, hand-rolling the same contract is fine; reach for the dependency only if
several components need it.

Most RedLens "state" is genuinely URL state, so the common shape is: the page owns the value
via `useUrlState` and passes it down controlled, while leaf components stay uncontrolled.

## 3. Make state visible to CSS, not to JS branches

Reflect state on the DOM as a data attribute and let the stylesheet react:

```tsx
<button data-active={active ? "true" : undefined} className="scope-pill" />
```

`data-state` (`open`/`closed`, `active`/`inactive`), plus `data-disabled`, `data-loading`,
`data-orientation`, `data-side`. Per `CLAUDE.md`: *don't add hover/click logic in JS when CSS
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
  memoized children, and `memo()` reserved for **list rows** — `SearchResult`,
  `CollapsibleNode`, `AtlasReader`, `TreeRow`. The house form is
  `export const X = memo(function X({…}: Props) {…})` so the component keeps its name in
  DevTools and stack traces.
- Expensive but interruptible updates can use `useTransition` (`useReportQuery.ts`).

## 5. Testing state

Tests are **co-located** (`Foo.tsx` ↔ `Foo.test.tsx`) and DOM tests opt in with
`// @vitest-environment jsdom` **on line 1** — vitest runs `node` by default here.

- Test through the public surface with `@testing-library/react` + `user-event`: render, act,
  assert on what the user sees, not on internal state.
- Test **both modes** of a controlled/uncontrolled component: uncontrolled updates on its own;
  controlled does nothing until the parent re-renders with a new `value`, and calls
  `onValueChange` either way.
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
- [ ] Controlled/uncontrolled: `value` / `defaultValue` / `onValueChange`, mode fixed at birth, no prop→state copy
- [ ] State reflected as `data-*` for CSS instead of JS class branching
- [ ] Effects clean up; dep arrays honest; `memo` only on list rows
- [ ] Co-located tests cover both modes; `// @vitest-environment jsdom` on line 1 for DOM tests
- [ ] `pnpm lint`, `pnpm build:ts`, `pnpm test` pass
