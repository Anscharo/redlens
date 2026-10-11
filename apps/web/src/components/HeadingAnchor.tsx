/**
 * A "#" link to a heading's fragment, shown while the heading
 * (`.heading-with-anchor` in index.css) is hovered. It is a pointer affordance
 * for copying the link: hidden from assistive technology and out of the tab
 * order, so the heading's accessible name stays its own text.
 */
export function HeadingAnchor({ id }: { id: string }) {
  return (
    <a href={`#${id}`} className="heading-anchor" aria-hidden="true" tabIndex={-1}>
      #
    </a>
  );
}
