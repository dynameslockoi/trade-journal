/**
 * The date picker still works when it is broken.
 *
 * A layout mistake in this component is invisible to every other check and to the compiler: the panel
 * renders, the grid is right, the month changes if you drive it from a script — it just stops
 * answering the mouse. That is exactly what happened when the caption was allowed to paint over the
 * nav buttons, and no test could see it.
 *
 * So the few properties that keep it usable are pinned to the source here:
 *
 *   * the nav is laid out in the caption's row (`navLayout="around"`), not as an overlay the caption
 *     can cover;
 *   * the caption's month and year are dropdowns (native `<select>`s hidden behind labels the app
 *     draws);
 *   * the grid undoes the journal's own `th`/`td` rules, which would otherwise shout the weekday
 *     names in uppercase and rule a line under every week;
 *   * the chosen day is a circle, as the design has it.
 *
 *   npm run test:ui
 */
import { readFileSync } from "node:fs";

const calendar = readFileSync(new URL("../components/ui/calendar.tsx", import.meta.url), "utf8");
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

/* ------------------------------------------------- the nav is in the flow, not an overlay */
check("the calendar asks for the nav in the caption's row", /navLayout="around"/.test(calendar), true);
check(
  "nothing positions the nav as an overlay",
  /\.pick-nav\s*\{[^}]*position:\s*absolute/.test(css),
  false,
);
check(
  "the caption's row lays its three columns out in the grid",
  /grid-template-columns:\s*26px minmax\(0, 1fr\) 26px/.test(rule(".pick-month")),
  true,
);

/* --------------------------------------------- month and year are dropdowns, still native */
check("the caption is the dropdown layout", /captionLayout="dropdown"/.test(calendar), true);
check("the dropdown's hidden select covers its label", /opacity:\s*0/.test(rule(".pick-dropdown")), true);

/* ------------------------------------------------- the grid opts out of the app's tables */
const gridCells = rule(".pick-grid th, .pick-grid td");
check("grid cells carry no rule of their own", /border:\s*0/.test(gridCells), true);
check("weekday names keep their case", /text-transform:\s*none/.test(gridCells), true);

/* -------------------------------------------------------------------- the design's day chip */
check("a day is a circle, not a rounded square", /border-radius:\s*999px/.test(rule(".pick-day-btn")), true);
check(
  "the chosen day is filled with the accent",
  /background:\s*var\(--accent\)/.test(rule(".pick-day-selected .pick-day-btn")),
  true,
);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll picker checks passed");
process.exit(failures ? 1 : 0);
