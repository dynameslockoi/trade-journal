/**
 * The screenshot gallery keeps the chart readable.
 *
 * A trade's screenshots are the evidence for the trade, and the first design of this section failed
 * the only job it had: every thumbnail was a fixed 190px box with `object-fit: contain`, so a 16:9
 * Bursa chart arrived as a strip floating in the middle of an empty frame — the one picture worth
 * reading was the smallest thing on the page. Nothing could see that: the images loaded, the grid was
 * correct, and no type error has an opinion about a picture being three hundred pixels too small.
 *
 * So the properties that make the section work are pinned to the sources here:
 *
 *   * the first plate spans the row, and the rest pair up under it;
 *   * a frame takes the loaded picture's proportions, so a wide chart fills its plate instead of
 *     being letterboxed by a height that was chosen for it;
 *   * the viewer is wider than the 900px dialog, which needs a doubled selector because the 580px
 *     default is declared later in the same layer and would otherwise win;
 *   * the arrow keys move between charts, and never while a note or a confirmation is being typed
 *     into.
 *
 *   npm run test:gallery
 */
import { readFileSync } from "node:fs";

const gallery = readFileSync(new URL("../components/screenshot-gallery.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/journal/[id]/page.tsx", import.meta.url), "utf8");
const edit = readFileSync(new URL("../app/journal/[id]/edit/page.tsx", import.meta.url), "utf8");
const create = readFileSync(new URL("../app/journal/new/page.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

/** Every declaration of the rule written under exactly this selector; "" when it is not there. */
function rule(selector: string) {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
}

const at = (needle: string) => css.indexOf(needle);

/* ------------------------------------------------------------------ the plates and their grid */
check(
  "the first plate spans the card's full width",
  /grid-column:\s*1\s*\/\s*-1/.test(rule(".shot-grid > .shot-figure:first-child")),
  true,
);
check("the grid pairs the remaining charts", /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(rule(".shot-grid")), true);
check("no fixed-height thumbnail is left to letterbox a chart", /\.shot-thumb\s*\{/.test(css), false);
check("a frame starts at the shape of a chart capture", /aspect-ratio:\s*16\s*\/\s*9/.test(rule(".shot-frame")), true);
check("the picture is measured once it loads", /naturalWidth/.test(gallery) && /aspectRatio/.test(gallery), true);
check(
  "the picture's own ratio is clamped to what a plate can hold",
  /Math\.min\(\s*[\d.]+\s*,\s*Math\.max\(\s*[\d.]+\s*,/.test(gallery),
  true,
);

/* ------------------------------------------------------------------------------- the viewer */
/* The doubled class is the fix, not a style: `.dialog-content` states the 580px default later in
   this file at the same weight, so a single-class `.shot-dialog` would have lost to it. */
check("the viewer asks for a width a chart can be read in", /\.dialog-content\.shot-dialog\s*\{[^}]*width/.test(css), true);
check("the plain wide dialog uses the same doubling", /\.dialog-content\.dialog-wide\s*\{[^}]*width/.test(css), true);
check(
  "the viewer is declared after the plainer wide dialog, so it wins",
  at(".dialog-content.shot-dialog {") > at(".dialog-content.dialog-wide {"),
  true,
);
check("nothing declares the viewer's width as a single class", /(^|\n)\s*\.shot-dialog\s*\{[^}]*width/.test(css), false);
check("the picture is capped so the note and the footer fit one screen", /max-height:\s*56vh/.test(rule(".shot-view img")), true);

/* ------------------------------------------------------------------------- the notes, the copy */
check("a caption without a note invites one", /Add a note about this chart/.test(gallery), true);
check(
  "the box, the button and the toast all call it a note",
  ["Chart note", "Save note", "Note saved"].every(text => gallery.includes(text)),
  true,
);
check("the empty state invites a chart rather than reporting one", /No charts attached/.test(gallery), true);
check("a lone chart is not numbered like a set", /shots\.length === 1 \? "Screenshot"/.test(gallery), true);
check("a failed signature says so instead of loading forever", /Image unavailable/.test(gallery), true);
check("a chart can still be opened at full size", /Open full size/.test(gallery) && /target="_blank"/.test(gallery), true);

/* ---------------------------------------------------------------------------- the navigation */
check(
  "the arrows stay out of a note while it is being written",
  /tagName === "INPUT"/.test(gallery) && /tagName === "TEXTAREA"/.test(gallery),
  true,
);
check("the arrows stop moving the carousel behind a confirmation", /alert-dialog-content/.test(gallery), true);

/* ------------------------------------------------------------------- what a chart is a chart of */
check("the vocabulary is the entry chart and the exit chart", /KINDS: Kind\[\] = \["entry", "exit"\]/.test(gallery), true);
check(
  "anything else the column holds reads as unlabelled",
  /shot\.kind === "entry" \|\| shot\.kind === "exit"\s*\? shot\.kind : null/.test(gallery),
  true,
);
check(
  "the label shows on the plate and in the viewer",
  (gallery.match(/className="shot-kind"/g) ?? []).length >= 2,
  true,
);
check("the viewer names it with a two-state control", /aria-pressed=\{openKind === k\}/.test(gallery), true);
check(
  "the label saves on the press, not behind the note",
  /update\(\{ kind: next \?\? UNLABELLED \}\)/.test(gallery),
  true,
);
check(
  "a refused label puts the old one back and says so",
  /setKinds\(m => \(\{ \.\.\.m, \[open\.id\]: before \}\)\)/.test(gallery) && /toast\.error\(error\.message\)/.test(gallery),
  true,
);
check(
  "an attachment is not born with a label",
  /kind:\s*"after"/.test(create) || /kind:\s*"after"/.test(edit),
  false,
);

/* ------------------------------------------------------------------------------- both pages */
check("the detail page states how many charts there are", /shot-count/.test(detail), true);
check("the edit page counts them too", /shot-count/.test(edit), true);
check("the edit page points at the upload box below it", /emptyHint="/.test(edit), true);

console.log(failures ? `\n${failures} check(s) failed` : "\nThe gallery reads as a chart, not a thumbnail");
process.exit(failures ? 1 : 0);
