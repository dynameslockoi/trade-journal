/**
 * The Analytics page stays four views, and a chart never leaves its table behind.
 *
 * The page was one column with eight metric cards, ten charts, the sector strip and eight breakdown
 * tables on it — the same eight dimensions drawn twice, in one 6,000-odd-pixel scroll. Divided into
 * Overview, Setups, Timing and Sectors, the division itself is invisible: a dimension quietly moved
 * to the wrong view still renders, every chart still draws, and nothing in the app looks broken. The
 * two properties that keep it honest are therefore pinned here:
 *
 *   * **Every dimension is drawn exactly once.** Eight dimensions, four views, one owner each. A
 *     dimension added to the journal and forgotten here would be charted nowhere; a copy-paste that
 *     lists one twice would show the same chart in two views.
 *   * **A dimension's chart and its table are drawn together.** The table is how you find out whether
 *     a bar is one trade or a hundred, so a chart in Setups and its table in Timing would leave that
 *     question unanswerable from either view. Both halves come from one `panels` entry and are
 *     rendered by one component, which is what this asserts.
 *
 *   npm run test:analytics
 */
import { readFileSync } from "node:fs";
import { DIMENSIONS, VIEWS, VIEW_DIMENSIONS, isView, resolveView, viewHref } from "../lib/analytics-views.ts";

const page = readFileSync(new URL("../app/analytics/page.tsx", import.meta.url), "utf8");
/**
 * Source with its comments removed, so a check is about the code and not about the prose beside it —
 * this page explains its own decisions, and an explanation that names `router.replace` must not be
 * mistaken for a navigation being there.
 */
const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The source of a top-level function, from its declaration to the line that closes it. */
function body(name: string) {
  const at = code.indexOf(`function ${name}(`);
  return at < 0 ? "" : code.slice(at, code.indexOf("\n}", at));
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

/* ------------------------------------------------- the eight dimensions have one owner each */
const owned = VIEWS.flatMap(([view]) => VIEW_DIMENSIONS[view]);
check("the record covers the views, and only the views", Object.keys(VIEW_DIMENSIONS).sort().join(","), VIEWS.map(([view]) => view).sort().join(","));
check("every dimension is charted by some view", [...owned].sort().join(","), [...DIMENSIONS].sort().join(","));
check("no dimension is charted twice", owned.length, new Set(owned).size);
// Overview's own blocks are the metric cards and the two curves, not a dimension, so it owns none.
check(
  "no view is an empty tab",
  VIEWS.filter(([view]) => view !== "overview" && !VIEW_DIMENSIONS[view].length).length,
  0,
);

/* ------------------------------------------------- and the page draws them the way it says */
check("the strip is built from the view list", /VIEWS\.map\(/.test(code), true);
check("there is one pane per view", (code.match(/<TabsContent value=/g) ?? []).length, VIEWS.length);
for (const [view, label] of VIEWS) {
  check(`the ${label} pane is there`, code.includes(`<TabsContent value="${view}"`), true);
}
for (const [view] of VIEWS) {
  const dims = VIEW_DIMENSIONS[view];
  if (dims.length > 1) check(`${view} draws its dimensions from the record`, code.includes(`VIEW_DIMENSIONS.${view}.map`), true);
  if (dims.length === 1) check(`${view} draws its single dimension`, code.includes(`panels.${dims[0]}`), true);
}
// Every dimension is described once, in the one object both halves read.
for (const dimension of DIMENSIONS) {
  check(`panels describes the ${dimension} dimension`, new RegExp(`^\\s*${dimension}: \\{`, "m").test(code), true);
}

/* ------------------------------------------------------- so a chart cannot lose its table */
const pair = body("DimensionPair");
check("the pair is one component", pair.length > 0, true);
check("it draws the chart", /<PnlBars\b/.test(pair), true);
check("and the table with it", /<Breakdown\b/.test(pair), true);
check("the chart draws this dimension's rows", /<PnlBars data=\{panel\.rows\}/.test(pair), true);
check("and the table lists those same rows, not another set", /<Breakdown title=\{panel\.tableTitle\} rows=\{panel\.rows\}/.test(pair), true);
check("and both are deferred until they are scrolled to", (pair.match(/<OnScreen\b/g) ?? []).length, 2);
check("no view draws a chart or a table on its own", (code.match(/<PnlBars\b|<Breakdown\b/g) ?? []).length, 2);

/* ------------------------------------------- the sector strip belongs to the sector question */
const sectorsAt = code.indexOf('<TabsContent value="sectors"');
const sectorsPane = code.slice(sectorsAt, code.indexOf("</TabsContent>", sectorsAt));
check("the month strip is in the sector view", /<SectorSentiment\b/.test(sectorsPane), true);
check("and nowhere else", (code.match(/<SectorSentiment\b/g) ?? []).length, 1);

/* ----------------------------------------------- a switch is a repaint, not a page change */
// `router.replace` would send the switch through the layout's server render — the same seeded row
// reads the first HTML pays for — to repaint a page that already holds its data. The address bar is
// written with the native history API instead, which is invisible in behaviour and easy to "fix".
check("a switch writes the address bar", /window\.history\.replaceState/.test(code), true);
check("and does not navigate to it", /\brouter\.(replace|push)\(/.test(code), false);
check("the strip is driven by the view state", /<Tabs value=\{view\}/.test(code), true);
// Radix unmounts an inactive pane by default, so the other three views' charts are never built.
check("no pane is force-mounted", /forceMount/.test(code), false);
// The strip is outside the loading branch, so a view can be chosen before its rows arrive.
check(
  "the strip is drawn above the loading branch",
  code.indexOf('className="tabs-bar"') < code.indexOf("loading ?"),
  true,
);

/* ------------------------------------------------------------------ where a URL lands */
check("a real view is accepted", isView("timing"), true);
check("an empty one is not", isView(""), false);
check("a missing one is not", isView(null), false);
check("an unknown one is not", isView("Tabs"), false);
check("a strategy link opens the view that draws it", resolveView(null, "b1f2"), "setups");
check("a bare page opens on the default", resolveView(null, null), "overview");
check("an explicit view wins over the strategy", resolveView("timing", "b1f2"), "timing");
check("an unknown view falls back rather than breaking", resolveView("nope", null), "overview");
check("a stale view with a strategy still lands usefully", resolveView("nope", "b1f2"), "setups");

/* ------------------------------------------------------------------ and what the bar shows */
check(
  "a switch keeps the filters that travel in the URL",
  viewHref("/analytics", "from=2026-01-01&strategy=b1f2", "timing"),
  "/analytics?from=2026-01-01&strategy=b1f2&view=timing",
);
check("a leading ? is accepted", viewHref("/analytics", "?from=2026-01-01", "setups"), "/analytics?from=2026-01-01&view=setups");
check("a bare page still names its view", viewHref("/analytics", "", "sectors"), "/analytics?view=sectors");
check("switching back does not double the parameter", viewHref("/analytics", "view=timing", "timing"), "/analytics?view=timing");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll analytics view checks passed");
process.exit(failures ? 1 : 0);
