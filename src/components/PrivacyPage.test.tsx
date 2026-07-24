// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrivacyPage } from "./PrivacyPage";

afterEach(cleanup);

it("renders PRIVACY.md, exercising the heading/list/link/strong renderers", () => {
  render(<PrivacyPage />);
  // h1 + h2 renderers
  expect(screen.getByRole("heading", { level: 1, name: /privacy policy/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: /data that is not linked to you/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: /who we share data with/i })).toBeInTheDocument();
  // ul/li + strong renderers (a bolded term inside a bullet)
  expect(screen.getByText(/usage analytics/i)).toBeInTheDocument();
  // a renderer — contact points at the repo, not an email
  const link = screen.getByRole("link", { name: /github repository/i });
  expect(link).toHaveAttribute("href", expect.stringContaining("github.com"));
});
