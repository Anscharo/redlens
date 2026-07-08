// Strict validator for patch-notes.md.
//
// This is deliberately separate from the frontend parser in
// src/lib/patchNotes.ts: the parser is LENIENT (it silently ignores anything
// it doesn't recognize so the homepage never crashes on a typo), whereas this
// is STRICT (it rejects anything off-format so a typo is caught before commit).
// The two share the shape but not the intent, so they don't share code.
//
// Pure: takes the raw file text, returns an array of human-readable error
// strings (empty array == valid). The CLI wrapper in
// scripts/required/check-patch-notes.mjs handles file IO and exit codes.

const DATE_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const BULLET_RE = /^(\s*)-\s*(.*)$/;

// The homepage shows only the 10 most recent bullets across all dates
// (src/lib/patchNotes.ts), so a date group at or past this size hides every
// earlier date entirely.
const MAX_BULLETS_PER_GROUP = 10;

// True only for a real calendar date in YYYY-MM-DD form (rejects e.g. 2026-13-40).
function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

export function validatePatchNotes(raw) {
  const errors = [];
  const lines = raw.split("\n");

  let inComment = false; // inside a multi-line <!-- ... --> block
  let seenDate = false; // have we opened any date group yet?
  let prevDate = null; // previous group's date, for ordering
  let curGroupBullets = 0; // bullets seen in the current group
  let curGroupLine = 0; // line number of the current group's heading

  const closeGroup = () => {
    if (!seenDate) return;
    if (curGroupBullets === 0) {
      errors.push(`Line ${curGroupLine}: date "${prevDate}" has no bullets under it.`);
    } else if (curGroupBullets > MAX_BULLETS_PER_GROUP) {
      errors.push(
        `Line ${curGroupLine}: date "${prevDate}" has ${curGroupBullets} bullets — max ${MAX_BULLETS_PER_GROUP} per date (the homepage shows only the 10 most recent bullets, so a larger group hides every earlier date). Condense: one bullet per feature, fold fixes in.`,
      );
    }
  };

  lines.forEach((line, i) => {
    const ln = i + 1;

    // Comment handling — assumes comments occupy whole lines (as in the seed).
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      return;
    }
    if (line.includes("<!--")) {
      if (!line.includes("-->")) inComment = true;
      return;
    }

    if (line.trim() === "") return; // blank line

    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      closeGroup(); // the previous group ends here
      const date = dateMatch[1];
      if (!isRealDate(date)) {
        errors.push(`Line ${ln}: "${date}" is not a real calendar date.`);
      } else if (prevDate && date >= prevDate) {
        errors.push(
          `Line ${ln}: date "${date}" must be strictly older than the one above it ("${prevDate}"). List newest-first with no duplicates.`,
        );
      }
      seenDate = true;
      prevDate = date;
      curGroupBullets = 0;
      curGroupLine = ln;
      return;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      if (!seenDate) {
        errors.push(`Line ${ln}: bullet appears before any "## YYYY-MM-DD" date heading.`);
        return;
      }
      if (bulletMatch[1].length > 0) {
        errors.push(`Line ${ln}: bullet must not be indented.`);
      }
      if (bulletMatch[2].trim() === "") {
        errors.push(`Line ${ln}: empty bullet.`);
      }
      curGroupBullets++;
      return;
    }

    // A heading-looking line that isn't a valid date heading.
    if (/^#+\s/.test(line)) {
      errors.push(
        `Line ${ln}: headings must be "## YYYY-MM-DD" (two #, ISO date), got: ${line.trim()}`,
      );
      return;
    }

    errors.push(`Line ${ln}: unrecognized line (expected a date heading or "- bullet"): ${line.trim()}`);
  });

  closeGroup(); // close the final group

  if (!seenDate) {
    errors.push('No date groups found — expected at least one "## YYYY-MM-DD" heading.');
  }

  return errors;
}
