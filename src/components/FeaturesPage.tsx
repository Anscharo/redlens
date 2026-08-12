import { useEffect } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { HEADER_OFFSET } from "../lib/layout";
import { Link } from "./Link";
import { FEATURE_GROUPS } from "./featuresData";

export function FeaturesPage() {
  useDocumentTitle("Features: Sky Atlas by Redline");
  // The browser's own hash scroll fires before this route's content exists, so
  // a link straight to /features#radar would land at the top. Same pattern as
  // ProvenancePage. Anchors are the group `key`, not the title — a title can be
  // reworded, and that would silently break every link anyone saved.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-sm text-tan-3 mb-1">features</p>
        <h1 className="font-semibold mb-4" style={{ color: "var(--tan)", fontSize: 22 }}>
          Everything you can do
        </h1>
        <p className="text-base mb-8" style={{ color: "var(--tan-2)" }}>
          A complete guide to Sky Atlas by Redline, with a short how-to for each feature.
        </p>

        {FEATURE_GROUPS.map((g) => (
          <section key={g.key} id={g.key} className="mb-10" style={{ scrollMarginTop: HEADER_OFFSET }}>
            <div className="flex items-baseline gap-3 mb-1">
              <h2 className="text-lg font-semibold" style={{ color: "var(--tan)" }}>
                {/* The heading is its own anchor — a plain <a>, not a wouter
                    Link, so the browser does the in-page jump and honours the
                    section's scroll-margin-top. */}
                <a href={`#${g.key}`} className="features-anchor" title="Link to this section">
                  {g.title}
                </a>
              </h2>
              {g.href ? (
                // Leaves the router (preview mounts its own shell), so a plain
                // anchor and a full load — same treatment HomePage's card gets.
                <a href={g.href} className="mono text-sm link-accent">
                  {g.href}
                </a>
              ) : (
                g.route && (
                  <Link to={g.route} className="mono text-sm link-accent">
                    {g.route}
                  </Link>
                )
              )}
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--tan-2)" }}>
              {g.blurb}
            </p>

            <div className="space-y-5">
              {g.features.map((f) => (
                <div
                  key={f.name}
                  className="pl-4"
                  style={{ borderLeft: "1px solid var(--tan-3)" }}
                >
                  <p className="text-base font-semibold" style={{ color: "var(--tan)" }}>
                    {f.name}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--tan-2)" }}>
                    {f.what}
                  </p>
                  <div className="flex gap-3 mt-2">
                    <span className="mono text-sm text-tan-3 w-10 shrink-0">how</span>
                    {/* space-y-1.5, not -1: at 14px these steps wrap more often,
                        and a 4px gap between items reads as smaller than the gap
                        between two lines of the SAME item. */}
                    <ul className="space-y-1.5 flex-1 text-sm" style={{ color: "var(--tan-2)" }}>
                      {f.how.map((h) => (
                        <li key={h}>&middot; {h}</li>
                      ))}
                    </ul>
                  </div>
                  {f.note && (
                    <p className="mono text-sm mt-2" style={{ color: "var(--tan-3)" }}>
                      {f.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
