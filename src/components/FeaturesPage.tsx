import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { Link } from "./Link";
import { FEATURE_GROUPS } from "./featuresData";

export function FeaturesPage() {
  useDocumentTitle("Features: Sky Atlas by Redline");
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">features</p>
        <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--tan)" }}>
          Everything you can do
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--tan-2)" }}>
          A complete guide to Sky Atlas by Redline, with a short how-to for each feature.
        </p>

        {FEATURE_GROUPS.map((g) => (
          <section key={g.key} className="mb-10">
            <div className="flex items-baseline gap-3 mb-1">
              <h2 className="text-base font-semibold" style={{ color: "var(--tan)" }}>
                {g.title}
              </h2>
              {g.href ? (
                // Leaves the router (preview mounts its own shell), so a plain
                // anchor and a full load — same treatment HomePage's card gets.
                <a href={g.href} className="mono text-xs link-accent">
                  {g.href}
                </a>
              ) : (
                g.route && (
                  <Link to={g.route} className="mono text-xs link-accent">
                    {g.route}
                  </Link>
                )
              )}
            </div>
            <p className="text-xs mb-4" style={{ color: "var(--tan-2)" }}>
              {g.blurb}
            </p>

            <div className="space-y-5">
              {g.features.map((f) => (
                <div
                  key={f.name}
                  className="pl-4"
                  style={{ borderLeft: "1px solid var(--tan-3)" }}
                >
                  <p className="text-sm font-semibold" style={{ color: "var(--tan)" }}>
                    {f.name}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--tan-2)" }}>
                    {f.what}
                  </p>
                  <div className="flex gap-3 mt-2">
                    <span className="mono text-xs text-tan-3 w-8 shrink-0">how</span>
                    <ul className="space-y-1 flex-1 text-xs" style={{ color: "var(--tan-2)" }}>
                      {f.how.map((h) => (
                        <li key={h}>&middot; {h}</li>
                      ))}
                    </ul>
                  </div>
                  {f.note && (
                    <p className="mono text-xs mt-2" style={{ color: "var(--tan-3)" }}>
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
