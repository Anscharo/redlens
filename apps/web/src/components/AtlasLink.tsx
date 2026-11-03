import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import { useSearchParams } from "wouter";
import { Link } from "./Link";
import { ROUTES } from "@/lib/routes";
import { track } from "../lib/analytics";
import { hiddenTargetHref, useFilterHides } from "../lib/atlasFilter";

// Like <Link>, but when the destination is /atlas, folds ?split= and ?subset=
// from the current URL into the target so the comparison pane and the
// changed/selected-only filter persist across atlas-internal navigation and
// across search → atlas navigation. A target the filter hides goes where
// hiddenTargetHref says, usually the comparison pane. From any other route (no
// split/subset in URL) it is a no-op equivalent to <Link>.
interface Props extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  to: string;
}

type Folded = { href: string; splitId: string | null };

// A destination that names its own subset or split chose them, so it is left
// as written. One that names a panel (?view=) is read unfiltered, since the
// comparison pane has no panels to show it in.
function foldHidden(np: URLSearchParams, target: string, live: URLSearchParams): Folded {
  if (np.has("view")) {
    const split = live.get("split");
    if (split && split !== target) np.set("split", split);
    return { href: `${ROUTES.ATLAS}?${np}`, splitId: null };
  }
  const { kind, href } = hiddenTargetHref(target, live);
  return { href, splitId: kind === "split" && live.get("split") !== target ? target : null };
}

function foldParams(to: string, live: URLSearchParams, filterHides: (id: string) => boolean): Folded {
  const split = live.get("split");
  const subset = live.get("subset");
  if (!(split || subset) || !to.startsWith(`${ROUTES.ATLAS}?`)) return { href: to, splitId: null };
  const [, query = ""] = to.split("?", 2);
  const np = new URLSearchParams(query);
  const target = np.get("id");
  const chosen = np.has("subset") || np.has("split");
  if (target && !chosen && filterHides(target)) return foldHidden(np, target, live);
  if (split && !np.has("split")) np.set("split", split);
  if (subset && !np.has("subset")) np.set("subset", subset);
  return { href: `${ROUTES.ATLAS}?${np}`, splitId: null };
}

const isPlainClick = (e: MouseEvent) => e.button === 0 && !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey);

export const AtlasLink = forwardRef<HTMLAnchorElement, Props>(function AtlasLink(
  { to, onClick, ...rest },
  ref,
) {
  const [params] = useSearchParams();
  const filterHides = useFilterHides();
  const { href, splitId } = foldParams(to, params, filterHides);
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // A caller that handled the click itself (preventDefault) tracks its own navigation.
    if (!splitId || e.defaultPrevented || !isPlainClick(e)) return;
    track("atlas_split_open", { node_id: params.get("id"), split_id: splitId, via: "filtered" });
  };
  return <Link ref={ref} to={href} onClick={handleClick} {...rest} />;
});
