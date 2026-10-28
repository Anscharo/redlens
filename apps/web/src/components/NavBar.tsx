import { Link } from "./Link";
import { NAV_PAGE_ROUTES, type NavPage } from "@/lib/routes";
import { ProfileButton } from "./chat/ProfileButton";
import { ThemeButton } from "./chat/ThemeButton";
import { useDataSource } from "../lib/dataSource";
import { usersEnabled } from "../lib/usersEnabled";
import { FeedbackButton } from "./feedback/FeedbackButton";

export interface NavBarProps {
  activePage: NavPage | null;
}

export function NavBar({ activePage }: NavBarProps) {
  // Reports + chat are disabled in preview mode (they'd read main data / need a
  // logged-in session); reader + radar stay. Previews is hidden there too: the
  // preview bar's own back link already leads to the index. Feedback and the
  // colour-scheme picker are NOT gated on preview — a broken preview is exactly
  // when someone wants to report it, and theme is per-browser, not account data.
  const { preview } = useDataSource();
  return (
    <div className="nav-bar order-2 sm:order-3 flex-1 flex items-center justify-end gap-1 sm:gap-2">
      <NavLink page="atlas" active={activePage === "atlas"}>
        Reader
      </NavLink>
      <NavLink page="radar" active={activePage === "radar"}>
        Radar
      </NavLink>
      {/* Previews is a plain <a>: /preview is its own page outside the router
          (main.tsx). Hidden on phones, where a fourth link pushes the row past
          the screen; the home page's Preview card reaches it there. */}
      {!preview && (
        <>
          <NavLink page="reports" active={activePage === "reports"}>
            Reports
          </NavLink>
          <a href="/preview" className="nav-link hidden sm:inline-block shrink-0 px-3 py-1.5 rounded text-sm">
            Previews
          </a>
        </>
      )}
      <FeedbackButton />
      <ThemeButton />
      {usersEnabled() && !preview && <ProfileButton />}
    </div>
  );
}

function NavLink({
  children,
  page,
  active,
}: {
  children: React.ReactNode;
  page: NavPage;
  active: boolean;
}) {
  return (
    <Link
      to={NAV_PAGE_ROUTES[page]}
      className="nav-link shrink-0 px-1.5 sm:px-3 py-1.5 rounded text-[13px] sm:text-sm"
      data-active={active ? "true" : undefined}
    >
      {children}
    </Link>
  );
}
