/**
 * One fingerprint for one STATE of an Atlas document — the same value whether
 * the state was read out of upstream's git history (the doc-versions walk) or
 * out of a built docs.json (a preview). That equality is the whole point: it is
 * what lets a fork's CONTENT be matched against upstream's history with no git
 * ancestry shared between the two repos (nga main is squash-merged, so a mirror
 * that takes it by copying content shares no commit SHAs with it).
 *
 * Neither existing hash can do this. The history walk's `contentHash` is
 * md5(raw body); the parser's is sha256(untrimmed raw lines). They are different
 * functions over different strings.
 *
 * The input is the document's CLEANED content — atlas-parser's `cleanContent`
 * output, i.e. exactly docs.json `content`. atlas-git-source hands back the RAW
 * body instead (multi-line single-backtick blocks not yet re-fenced: 283 of
 * 11,573 docs differ on that alone), so `gitEntryFingerprint` cleans it first.
 * Measured 2026-09: cleanContent(walk body) === source-loader content for every
 * document on all three layouts (11,573 consolidated, 11,340 atomized, 10,214
 * monolith). scripts_tests/doc-fingerprint.test.ts holds that to the checked-out
 * atlas, so a parser change that breaks it fails CI instead of silently making
 * every fork document look fork-authored.
 *
 * doc_no and title are part of the state on purpose: an upstream renumbering
 * changes no body, yet it was 720 of the 945 phantom "changed" documents a
 * two-week-stale mirror showed against live main.
 */

import crypto from "node:crypto";
import { cleanContent } from "./atlas-parser.mjs";

/** 128 bits of sha256 — ~50k rows, no collision concern, half the bytes. */
const FINGERPRINT_HEX = 32;

/** @param {{ doc_no: string, title: string, content: string }} node `content` MUST be cleaned (docs.json `content`). */
export function docFingerprint(node) {
  return crypto
    .createHash("sha256")
    .update(`${node.doc_no}\n${node.title}\n${node.content ?? ""}`)
    .digest("hex")
    .slice(0, FINGERPRINT_HEX);
}

/** For an atlas-git-source snapshot entry, whose `content` is the raw body. */
export function gitEntryFingerprint(entry) {
  return docFingerprint({ doc_no: entry.doc_no, title: entry.title, content: cleanContent((entry.content ?? "").split("\n")) });
}
