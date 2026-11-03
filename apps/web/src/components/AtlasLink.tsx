import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useSearchParams } from "wouter";
import { Link } from "./Link";
import { ROUTES } from "@/lib/routes";
import { splitHref, useFilterHides } from "../lib/atlasFilter";

// Like <Link>, but when the destination is /atlas, folds ?split= and ?subset=
// from the current URL into the target so the comparison pane and the
// changed/selected-only filter persist across atlas-internal navigation and
// across search → atlas navigation. A target the filter hides opens in the
// comparison pane instead (see splitHref). From any other route (no
// split/subset in URL) it is a no-op equivalent to <Link>.
interface Props extends Omit<ComponentPropsWithoutRef<"a">, "href"> {
  to: string;
}

function foldParams(to: string, live: URLSearchParams, filterHides: (id: string) => boolean): string {
  const split = live.get("split");
  const subset = live.get("subset");
  if (!(split || subset) || !to.startsWith(`${ROUTES.ATLAS}?`)) return to;
  const [, query = ""] = to.split("?", 2);
  const np = new URLSearchParams(query);
  const target = np.get("id");
  if (target && filterHides(target)) return splitHref(target, live);
  if (split && !np.has("split")) np.set("split", split);
  if (subset && !np.has("subset")) np.set("subset", subset);
  return `${ROUTES.ATLAS}?${np}`;
}

export const AtlasLink = forwardRef<HTMLAnchorElement, Props>(function AtlasLink(
  { to, ...rest },
  ref,
) {
  const [params] = useSearchParams();
  const filterHides = useFilterHides();
  return <Link ref={ref} to={foldParams(to, params, filterHides)} {...rest} />;
});
