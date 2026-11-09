// The team's browsers carry a mark that tags every analytics event
// `internal: true`, so PostHog's test-account filter can leave the team out.
// The server decides who is on the team (/api/auth/me answers `internal: true`
// for a login on INTERNAL_GITHUB_LOGINS). The mark is stored in localStorage so it
// outlives sign-out and also covers the reading done while signed out.
// Storage can throw in private mode or with blocked site data; the mark is then
// simply absent, which only means the visit counts as an outside one.
const KEY = "rl-internal";

export function readInternalMark(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveInternalMark(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // see the module comment
  }
}
