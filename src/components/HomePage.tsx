import { Link } from "./Link";
import { NAV_PAGE_ROUTES, type NavPage } from "../lib/routes";

const SKY_URL = "https://sky.money";
const ATLAS_URL = "https://github.com/sky-ecosystem/next-gen-atlas";

const CARDS: { page: NavPage; name: string; desc: string }[] = [
  {
    page: "atlas",
    name: "Reader",
    desc: "Read the atlas with side-by-side annotations, glossary, and history",
  },
  {
    page: "radar",
    name: "Radar",
    desc: "View info about Parties in the Sky Ecosystem: Agents, Facilitators, Alignment Conservers and more",
  },
  {
    page: "reports",
    name: "Reports",
    desc: "Specific reports extracted directly from the Atlas as it updates",
  },
];

export function HomePage() {
  return (
    <main className="flex-1 overflow-y-auto px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-tan mb-4">Sky Atlas by Redline</h1>
          <h2 className="text-2xl text-tan-2 mb-6">
            Views into the Sky
              Atlas
          </h2>
          <p className="text-base leading-relaxed text-tan-2" style={{ maxWidth: "56ch" }}>
            The{' '}
            <a href={ATLAS_URL} target="_blank" rel="noopener noreferrer" className="link-accent">
            Sky Atlas
            </a>{' '}
            is the governance document at the heart of the 
            {' '}
            <a href={SKY_URL} target="_blank" rel="noopener noreferrer" className="link-accent">
            Sky protocol
            </a>{" "} — thousands of interconnected sections defining roles, rules, and responsibilities across the ecosystem.
            Sky Atlas by Redline makes it fast and approachable: full-text search, inline annotations and
            history, a map of how parties relate to each other, and purpose-built reports extracted
            straight from the source.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CARDS.map((c) => (
            <Link
              key={c.page}
              to={NAV_PAGE_ROUTES[c.page]}
              className="home-card flex flex-col items-start text-left w-full"
            >
              <p className="text-sm font-semibold text-tan mb-2">{c.name}</p>
              <p className="text-xs text-tan-3 leading-relaxed">{c.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
