export interface Feature {
  name: string;
  what: string; // one line: what it is
  how: string[]; // concrete usage steps / tips
  note?: string; // caveat, sign-in requirement, or availability
}

export interface FeatureGroup {
  /** Also the section's hash anchor (/features#<key>), so it is a PUBLIC URL —
   *  renaming one breaks every link anyone saved or shared. Titles are free to
   *  be reworded; these are not. */
  key: string;
  title: string;
  route?: string; // primary in-SPA route for this area (must exist in ROUTES)
  href?: string; // destination that leaves the router (preview owns its own shell)
  blurb: string;
  features: Feature[];
}
