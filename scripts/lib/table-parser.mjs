/**
 * Markdown table parsing utilities for Atlas Active Data tables.
 */

import { ETH_ADDR_RE } from "./address-chains.mjs";
import { MD_URL_RE } from "./graph-patterns.mjs";

/**
 * Parse a markdown table from Atlas node content.
 * Returns an array of row objects keyed by column header (raw markdown preserved).
 */
export function parseMarkdownTable(content) {
  const lines = content.split("\n");
  const tableLines = lines.filter((l) => l.trim().startsWith("|"));
  if (tableLines.length < 3) return [];

  // Separator row: every cell is only dashes, colons, and spaces
  const isSeparator = (line) =>
    line
      .split("|")
      .slice(1, -1)
      .every((c) => /^[\s:-]+$/.test(c));

  const dataLines = tableLines.filter((l) => !isSeparator(l));
  if (dataLines.length < 2) return [];

  const splitCells = (line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

  const [headerLine, ...rowLines] = dataLines;
  const headers = splitCells(headerLine);

  return rowLines.map((line) => {
    const cells = splitCells(line);
    const row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] ?? "";
    }
    return row;
  });
}

/** Extract all lowercase 0x EVM addresses from a markdown cell. */
export function extractEthAddresses(cell) {
  return [...cell.matchAll(ETH_ADDR_RE)].map((m) =>
    m[0].toLowerCase()
  );
}

/** Extract the first URL from a markdown cell (from a [text](url) link). */
export function extractUrl(cell) {
  const m = cell.match(MD_URL_RE);
  return m ? m[1] : null;
}
