---
name: react-components
description: >
  How to create, update, refactor, or split a React component in SAbR,
  following the components.build specification (composition, types,
  accessibility, data attributes). Use when adding a component under
  src/components/**, extracting or splitting a component that has grown too
  big, changing a component's props API, building a compound/multi-part
  component (dialog, menu, tabs, accordion, panel), or reworking a
  component's markup, ARIA, or keyboard behaviour. Covers
  one-component-one-element, extending native HTML props, Root/Trigger/Content
  composition, as / asChild, semantic HTML + ARIA, and data-state.
  Keywords: react component, new component, add a component, refactor
  component, extract component, split component, component too big, component
  API, props, ComponentProps, compound component, Root Trigger Content,
  asChild, as prop, polymorphic, data-state, accessibility, a11y,
  aria, keyboard navigation, focus management, semantic HTML, src/components,
  components.build.
license: MIT
metadata:
  author: anscharo
  version: "1.0"
---

# Building React Components

SAbR follows [components.build](https://www.components.build) — the open specification
for modern UI components co-authored by Hayden Bleasel and shadcn. This skill is that spec
reduced to the parts that bind here, plus the SAbR house rules that extend it.

**Deliberately out of scope:** the spec's class-merging chapters (`cn`, `tailwind-merge`,
`clsx`, CVA) and its distribution chapters (npm, registry, marketplaces). SAbR is an
application, not a published component library, and does not use a class-merge helper.
For visual/token work use the **`ui-look-and-feel`** skill instead.

**If you are building a `/reports/<slug>` page, stop and use the `new-report` skill** —
it is the canonical checklist for that surface. Come back here for the components it renders.

## Scope: new and changed code only — never retrofit

Most of this codebase predates these rules and does not follow them. Today only `Link.tsx`
and `AtlasLink.tsx` extend `React.ComponentProps`; only `NavBarProps` and `ReportShellProps`
are exported prop types; a handful of components spread `...props` at all. **That is expected
and is not a defect to go fix.** Apply these rules to the component you are creating
or substantially reworking. Do not open sweeping conformance PRs, do not "fix" a neighbouring
file because you noticed it, and do not treat an existing component's shape as a bug. Where a
rule below is aspirational rather than established practice, it is marked **[new code]**.

## 0. Classify before you build

The spec's decision flow (`definitions`), in the order to ask:

1. Single behavior/a11y concern, no styling → **primitive**
2. Styled, reusable UI element → **component** ← almost everything in `src/components/**`
3. Concrete product use case, opinionated composition → **block** (e.g. a whole report body)
4. Non-visual logic for ergonomics → **utility** → it belongs in `src/lib/` or `src/hooks/`, not `src/components/`

That last one is the most commonly missed. SAbR states it as a hard rule
(`CLAUDE.md`): **data logic lives in pure `src/lib/*` modules, not in components, so it is
testable without React.** The reference pairs are
`src/lib/activeDataIndex.ts` ↔ `src/components/reports/ActiveDataReport.tsx`,
`src/lib/facilitatorResponsibilities.ts` ↔ `OpFacilitatorsReport.tsx`, and
`src/lib/crossviewShape.ts` ↔ `CrossViewShape.tsx`. If your new component contains a loop
that derives rows, that loop belongs in `src/lib/`.

## 1. One component = one element

Each exported component should wrap a **single** HTML or JSX element. A component that
renders several structural elements cannot be customised without prop drilling.

```tsx
// ❌ anti-pattern — one component, four elements, three escape-hatch props
const Card = ({ title, description, footer, ...props }) => (
  <div {...props}>
    <div className="card-header"><h2>{title}</h2><p>{description}</p></div>
    <div className="card-footer">{footer}</div>
  </div>
);
```

Split it into `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardFooter`. The spec's
stated payoff: maximum customisation, no prop drilling, caller-controlled semantic HTML,
direct control over ARIA, and one simple mental model.

**The working budget: about 6 props.** Past that, ask whether the extra props are really
*parts* of the component wearing a prop disguise — a `title`, a `footer`, an `actions` node —
and split instead. This is a design signal, not a lint rule; a component with 8 genuinely
scalar props is fine, one with 8 `ReactNode` slots is a composition waiting to happen.
Plenty of existing files take slot-shaped props, so expect to meet them.

**Known exception — `ReportShell`.** It takes ~17 props in a deliberately fixed slot order
(title → description → controls → filter summary → count + actions → body) because it also
owns `useDocumentTitle` and the `report_view` event *so a new report cannot forget them*.
That centralisation is the point, and 13 pages depend on it. **Don't refactor it, and don't
cite it as precedent** — it is the shape this section is steering new components away from.

This is also how you satisfy the SAbR size rules — **max ~150 lines per file, max 3
components per file** (and only if 2 of them are under 8 lines). 31 files currently exceed
150 lines; those are known debt, to be split when you touch them, not in a big-bang refactor.

## 2. Extend the native element's props **[new code]**

```tsx
export type FilterPillProps = React.ComponentProps<"button"> & {
  /** Whether this pill is the active filter. */
  active?: boolean;
};

export function FilterPill({ active, ...props }: FilterPillProps) {
  return <button data-state={active ? "active" : "inactive"} {...props} />;
}
```

Rules, all from `types`. These are the least-established rules in this skill — the existing
precedents are `Link.tsx` and `AtlasLink.tsx`, which use
`interface X extends Omit<ComponentPropsWithoutRef<"a">, "href">`. Apply them to new
components; leave existing ones alone.

- **Extend the wrapped element**: `React.ComponentProps<"div" | "button" | "input" | "a" | "form">`.
  Extending an existing component? `ComponentProps<typeof Thing>`.
- **Spread props last.** `<div className="base" {...props} />` lets callers override;
  `<div {...props} className="base" />` silently ignores them. This is the single most common bug.
- **Export the props type**, named `<ComponentName>Props`, so callers can extend, wrap, and
  extract from it.
- **Never take a prop that collides with a native HTML attribute** unless you mean to override
  it — `title` on a `div` is the classic trap. Use `heading` instead.
- **JSDoc every custom prop.** It is the component's only API documentation here.

SAbR specifics: **named exports only** (the only two `export default` in
`src/` are `App.tsx` and `NodeContentInner.tsx`, and lazy routes bridge named→default via
`lazyImport` in `src/lib/lazyRoutes.tsx`). **No `React.FC`** — zero usages, plain function
declarations only. `verbatimModuleSyntax` is on, so type-only imports must be `import type`.
`jsx: "react-jsx"` means no `import React` line.

Inline destructured prop types are the dominant local style; promote to a named exported
`interface`/`type` once the list is long, exported, or a discriminated union
(`src/components/StatusPill.tsx` is the union example).

## 3. Compose instead of configuring

When a component starts accumulating props that describe *parts* of it, break it into
cooperating subcomponents that share state through context.

```tsx
const AccordionContext = createContext<{ open: boolean; onToggle: (open: boolean) => void }>({
  open: false,
  onToggle: () => {},
});

export type AccordionRootProps = React.ComponentProps<"div"> & {
  open: boolean;
  onToggle: (open: boolean) => void;
};

export const Root = ({ children, open, onToggle, ...props }: AccordionRootProps) => {
  // Memoized: a fresh object literal here re-renders every consumer on every render.
  const value = useMemo(() => ({ open, onToggle }), [open, onToggle]);
  return (
    <AccordionContext.Provider value={value}>
      <div {...props}>{children}</div>
    </AccordionContext.Provider>
  );
};
```

Use the spec's naming vocabulary so the API is guessable:

| Part | Meaning |
| --- | --- |
| `Root` | container; owns shared state/context |
| `Trigger` | initiates an action (open/close/toggle) |
| `Content` | the shown/hidden body |
| `Item` | one repeated member |
| `Header` / `Body` / `Footer` | structural regions |
| `Title` / `Description` | primary heading / supporting text |

Render props (function-as-child) are for when the parent owns the data but the caller must
own the markup entirely.

## 4. Accessible by default

Accessibility is a baseline feature, not a follow-up ticket. SAbR is already strong here —
the tree is overwhelmingly real `<button>`s, with a single `<div onClick>` in production code
(a modal backdrop). Keep it that way.

- **Start from the semantic element.** `<button>` for actions, `<a href>` for navigation,
  `h1`–`h6` for headings, `<article>`/`<section>`/`<header>` for regions, `<ul>/<li>` for lists.
  Reach for `role=` only when no native element fits (SAbR does this for `tab`/`tablist`,
  `tree`/`treeitem`, `listbox`/`option`, `dialog`, `alert`, `combobox`, `switch`, `menu`).
- **The four ARIA rules**: don't use ARIA if semantic HTML will do; don't change native
  semantics unnecessarily; every interactive element must be keyboard accessible; never hide
  a focusable element from assistive tech.
- **Every interactive element needs an accessible name.** Icon-only buttons take **`aria-label`**
  — the house convention throughout the tree — with the glyph marked `aria-hidden="true"`. (Tailwind's
  built-in `sr-only` utility also works, but no component uses it today; prefer `aria-label`.)
- **Declare and implement a keyboard map** for every interactive component. The spec's
  standard maps: menu → `ArrowDown`/`ArrowUp`/`Home`/`End`/`Escape`; dropdown → adds
  `Enter`/`Space`, wrapping at both ends; tabs → `ArrowLeft`/`ArrowRight`/`Home`/`End` plus
  roving `tabIndex` (`0` for the active tab, `-1` for the rest); modal → `Escape` closes,
  `Tab`/`Shift+Tab` trapped, focus restored to the opener on close.
  `src/hooks/useTreeKeyboard.ts` is the local precedent.
- **Focus lives in CSS**, on `:focus-visible`, never `:focus` — see `src/index.css`.
- **Never convey meaning by colour alone**; pair it with text or an icon, and set
  `aria-invalid` + `aria-describedby` on errored fields.
- **Announce async changes** with `aria-live="polite"` (or `role="alert"` /
  `aria-live="assertive"` for errors) and `aria-busy` while loading — `StatusPill.tsx` does this.
- **Labels, not placeholders.** A placeholder disappears when typing.
- **Use the native `disabled` attribute.** The spec suggests preferring `aria-disabled` +
  an explanation; SAbR has deliberately kept native `disabled` (18 uses, no `aria-disabled`).
  Follow the house rule. If a disabled control genuinely needs to explain itself, add the
  explanation as adjacent text rather than switching the mechanism.
- Touch targets: 44×44px minimum **for new interactive controls**. Not retrofitted — this is
  not currently enforced repo-wide.

`oxlint` runs with the React plugin and catches a slice of this automatically (`pnpm lint`),
but it will not tell you a keyboard map is missing.

## 5. Expose state as data attributes

Do not add a className prop per state (`openClassName`, `closedClassName`, `classes={{…}}`) —
the spec names that an anti-pattern: it couples internal state to the styling API, explodes
the prop list, and makes state *combinations* unstylable.

Instead put the state on the element and let CSS select it:

```tsx
<div data-state={isOpen ? "open" : "closed"} {...props} />
```

- **`data-state`** for visual state, with the spec's shared vocabulary — `open`/`closed`,
  `active`/`inactive`, `on`/`off`. Related: `data-disabled`, `data-loading`,
  `data-orientation`, `data-side`, `data-align`, `data-placeholder`.
  **Use `data-state` for new components** rather than inventing another one-off boolean.
  The existing tree has grown a dozen-plus ad-hoc attributes (`data-active`, `data-open`, `data-on`,
  `data-hot`, `data-copied`, `data-status`, `data-place`, …) against one real `data-state`
  (`StageList.tsx`) — consistent naming is the point, so converge going forward.
  **Do not rename existing ones**; their selectors are wired into `index.css` and `chat.css`.
- **Props** remain the right home for variants, sizes, behaviour, and event handlers.
- **`data-slot` is not used in SAbR** and should not be introduced. The spec uses it as a
  stable hook for cross-component CSS targeting; this codebase targets with semantic classes
  instead. Zero occurrences — keep it that way.

This matches how SAbR already works: `FilterPills.tsx` toggles `data-active` and lets
`.scope-pill` in `src/index.css` do the rest. Per `CLAUDE.md`: *don't add hover/click logic in
JS when CSS will do it.*

## 6. Polymorphism: `as` vs `asChild`

Only when a component genuinely needs to render as a different element.

- **`as` prop** — simpler, no dependency, good for swapping plain HTML elements.
  Type it generically, never `any`:
  `type PolymorphicProps<E extends React.ElementType> = { as?: E } & React.ComponentPropsWithoutRef<E>`.
  Default to the *semantic* element (`article`, `nav`, `h2`), never `div`. Watch for invalid
  nesting (button-in-button, div-in-p) and remember the ARIA that the new element implies
  (`as="nav"` needs `aria-label`).
- **`asChild` + Radix `Slot`** — when you need real component composition, intelligent prop
  merging, or ref forwarding: `const Comp = asChild ? Slot : "div"`. It also eliminates
  wrapper hell (`<button><button/></button>`).

There is **no generic polymorphic `as` and no `asChild`/`Slot` in `src/` today** — but
`StatusPill.tsx` already ships the narrow version of this: `as?: "span" | "button"` as a
discriminated union, which is the preferred shape here. Prefer a closed union over an open
`React.ElementType` generic unless you genuinely need arbitrary elements.

`asChild` requires `@radix-ui/react-slot`, and **any dependency change must ship the
refreshed `pnpm-lock.yaml` in the same commit** — `pnpm install --frozen-lockfile` fails CI
and the Docker build otherwise. Don't add it speculatively.

If you do support `asChild`: single element child only (no fragments, no multiple children),
document it with the spec's exact JSDoc ("Change the default rendered element for the one
passed as a child, merging their props and behavior. @default false"), and make sure any child
component spreads `...props` or it will silently swallow the behaviour.

## Definition of done

- [ ] One element per exported component; ~6 props as the working budget; file under ~150 lines; ≤3 components per file
- [ ] Props extend `React.ComponentProps<…>`; **spread last**; `<Name>Props` exported; custom props JSDoc'd
- [ ] No prop name collides with a native HTML attribute
- [ ] Named export; no `React.FC`; `import type` for types
- [ ] Derived/row-building logic sits in `src/lib/`, not in the component
- [ ] Semantic element chosen first; accessible name present; keyboard map implemented; focus via `:focus-visible`
- [ ] State exposed as `data-*`, not per-state class props; new components use `data-state` vocabulary (no `data-slot`)
- [ ] Co-located `Foo.test.tsx` with `// @vitest-environment jsdom` on line 1
- [ ] `pnpm lint`, `pnpm build:ts` (or `tsc -b`), and `pnpm test` pass
- [ ] User-visible? → `patch-notes.md` bullet **and** `src/components/featuresData.ts` entry
