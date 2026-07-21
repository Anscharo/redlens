import type { LibraryData } from "../../lib/library";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";

const Count = ({ n }: { n: number }) => <span className="mono text-xs text-tan-3"> {n.toLocaleString()}</span>;

export function LibraryContents({
  toc,
  neededResearch,
}: {
  toc: LibraryData["toc"];
  neededResearch: LibraryData["neededResearch"];
}) {
  return (
    <div>
      <p className="text-xs mb-6" style={{ color: "var(--tan-3)" }}>
        Chunk-aware table of contents with subtree doc counts. Every entry links into the reader.
      </p>
      {toc.map((scope) => (
        <section key={scope.id} className="mb-8">
          <h2 className="text-base font-semibold mb-2" style={{ color: "var(--tan)" }}>
            <Link to={atlasHref(scope.id)} className="hover:underline">
              {scope.doc_no} {scope.title}
            </Link>
            <Count n={scope.docs} />
          </h2>
          <ul className="ml-1">
            {scope.articles.map((art) => (
              <li key={art.id} className="mb-1.5">
                <Link to={atlasHref(art.id)} className="text-sm link-accent">
                  {art.doc_no} {art.title}
                </Link>
                <Count n={art.docs} />
                {art.sections.length > 0 && (
                  <ul className="ml-5 mt-1">
                    {art.sections.map((sec) => (
                      <li key={sec.id} className="mb-0.5">
                        <Link to={atlasHref(sec.id)} className="text-xs hover:underline" style={{ color: "var(--tan-2)" }}>
                          {sec.doc_no} {sec.title}
                        </Link>
                        <Count n={sec.docs} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="mb-8">
        <h2 className="text-base font-semibold mb-2" style={{ color: "var(--tan)" }}>
          Needed Research
        </h2>
        <ul className="ml-1">
          {neededResearch.map((n) => (
            <li key={n.id} className="mb-0.5">
              <Link to={atlasHref(n.id)} className="text-sm link-accent">
                {n.doc_no} {n.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
