/**
 * Signing in, which the compiler and every other check are blind to.
 *
 * The auth card is one page holding two forms and a control that swaps them, and every part of that can
 * break without failing anything else: a panel that stays clickable when it is off screen submits a form
 * nobody can see, a spinner that never clears looks like a slow network rather than a bug, and the two
 * halves of a recovery link drifting apart (the `next` the email carries, the destination the callback
 * honours) turns the whole reset flow into a bounce to the sign-in page.
 *
 * So the behaviours are pinned where they live — the source of the card and the rules it depends on —
 * and the two pure rules that a URL can reach (`safeNextPath`, `isStaleSession`) are executed rather than
 * read, because those are the ones a crafted link or a dead cookie runs into.
 *
 *   npm run test:auth
 */
import { readFileSync } from "node:fs";
import { SESSION_ENDED, carriesAuthCookie, isStaleSession, safeNextPath } from "../lib/session.ts";

const card = readFileSync(new URL("../components/auth-card.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const callback = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../lib/supabase/middleware.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const resetPage = readFileSync(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

/**
 * Every declaration of the rule written under exactly this selector; "" when it is not there.
 *
 * Anchored to the start of a line on purpose: a plain `indexOf` also finds `.auth-panel {` inside
 * `.auth-forms[data-mode="reset"] .auth-panel {`, which is a different rule with the opposite
 * answer — the sort of quiet mismatch this script exists to catch, so it must not make it itself.
 */
function rule(selector: string) {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const match = pattern.exec(css);
  if (!match) return "";
  const at = match.index + match[0].length;
  return css.slice(at, css.indexOf("}", at));
}

const ORIGIN = "https://journal.example";

/* ------------------------------------------------- the two panels are one page, not two pages */
// Both forms are mounted at once and only the visible one is live. A version that unmounted the other
// would still pass every render check — and would lose what was typed when you switched.
check("both panels are rendered", (card.match(/data-panel="signin"/g) ?? []).length, 1);
check("and the other one", (card.match(/data-panel="signup"/g) ?? []).length, 1);
check("the box knows which panel is showing", card.includes("data-mode={mode}"), true);
check(
  "one dot per panel, lit by the mode",
  /className=\{mode === "signin" \? "on" : undefined\}[\s\S]{0,120}className=\{mode === "signup" \? "on" : undefined\}/.test(card),
  true,
);

/* ------------------------------------------------------------------- switching, both ways */
// One control drives both directions; a version hard-coded to one of them is the shape this breaks in.
check(
  "the seam control swaps to the other panel",
  card.includes('onClick={() => switchTo(mode === "signin" ? "signup" : "signin")}'),
  true,
);
check("the control is a real button", /className="auth-toggle"[\s\S]{0,80}type="button"|<button\s+type="button"\s+className="auth-toggle"/.test(card), true);
check("and it says what it does", /aria-label=\{mode === "signin" \? "Create an account" : "Sign in instead"\}/.test(card), true);
// Each form also offers the move in words, and each one points at the *other* panel.
check("sign-in offers sign-up", card.includes('<SignInForm onSwitch={() => switchTo("signup")} />'), true);
check("sign-up offers sign-in", card.includes('<SignUpForm onSwitch={() => switchTo("signin")} />'), true);
check("the switch keeps the address bar honest", card.includes('next === "signup" ? "/signup" : "/login"'), true);
check("and it does not push a history entry per switch", card.includes("window.history.replaceState(null"), true);

/* ------------------------------------------------------------------ the hidden panel is inert */
// `inert` and `aria-hidden` have to follow the mode, not a literal: inverted or fixed, the live panel
// disappears from the tab order and the dead one keeps its fields reachable.
check("the sign-in panel goes inert when it is not showing", card.includes('inert={mode !== "signin"}'), true);
check("the sign-up panel likewise", card.includes('inert={mode !== "signup"}'), true);
check("and the same for the screen reader", card.includes('aria-hidden={mode !== "signin"}'), true);
check("for both panels", card.includes('aria-hidden={mode !== "signup"}'), true);
check("no hard-coded inert", /inert(?!=\{)/.test(card), false);
// Belt and braces: a pointer cannot land on the panel that is off screen, and the live one takes clicks.
const panel = rule(".auth-panel");
check("the off-screen panel refuses the pointer", /pointer-events:\s*none/.test(panel), true);
check("and is invisible rather than merely faded out", /opacity:\s*0;/.test(panel), true);
const live = rule('.auth-forms[data-mode="signin"] .auth-panel[data-panel="signin"],\n.auth-forms[data-mode="signup"] .auth-panel[data-panel="signup"]');
check("the live panel takes them", /pointer-events:\s*auto/.test(live), true);
check("and is fully opaque", /opacity:\s*1;/.test(live), true);

/* ---------------------------------------------------------------------------- the loading state */
check("the button is disabled while the request is out", card.includes("disabled={loading} aria-busy={loading}"), true);
check("the spinner is drawn only while loading", card.includes('{loading && <span className="spinner" aria-hidden />}'), true);
check("the label changes while it waits", card.includes('busyLabel="Signing in…"'), true);
check("for sign-up too", card.includes('busyLabel="Creating…"'), true);
// The spinner and the label sit inside the same submit button, so the wait reads as one object. Read
// from the function's own body rather than a window of characters, which a longer comment re-breaks.
const submitButton = card.slice(
  card.indexOf("function SubmitButton"),
  card.indexOf("\nfunction ", card.indexOf("function SubmitButton")),
);
check("one submit button draws both", submitButton.includes('className="spinner"') && submitButton.includes("disabled={loading}"), true);
const spinner = rule(".spinner");
check("the spinner actually turns", /animation:\s*spin 0\.7s linear infinite/.test(spinner), true);
check("and the keyframes exist", css.includes("@keyframes spin"), true);
// A stuck spinner is the failure this guards: the request is started, and every path that ends without
// it navigates away has to clear it.
check("the request is started before it is awaited", card.indexOf("setLoading(true)") < card.indexOf("await supabase.auth.signInWithPassword"), true);
check(
  "a refused sign-in clears the wait",
  /if \(error\) \{\s*setError\(error\.message\);\s*setLoading\(false\);\s*return;\s*\}/.test(card),
  true,
);
check(
  "so does a refused account",
  /setError\(state\.detail\);\s*setLoading\(false\);\s*return;/.test(card),
  true,
);
// The success path never clears it, and should not: it navigates, and a cleared spinner in the frame
// before that reads as a failed attempt. Pinned so nobody "fixes" it into a flash.
check("success navigates instead of clearing", card.includes('window.location.href = "/";'), true);

/* ------------------------------------------------------------------- the height that animates */
// The two panels are different heights, so the box is measured from the live one. Without the
// measurement the card collapses (both panels are absolutely positioned); with a min-height instead, the
// card pops to the floor before growing, which is what it did before this rule was gated on `data-ready`.
check("the box is measured before paint", card.includes("useLayoutEffect("), true);
check("and re-measured when its content changes", card.includes("new ResizeObserver(measure)"), true);
check("the measurement is published to the CSS", (card.match(/data-ready=\{height === undefined \? undefined : ""\}/g) ?? []).length >= 2, true);
check("the height itself is inline", (card.match(/\$\{height\}px/g) ?? []).length >= 2, true);
check("the height is transitioned", /transition:\s*height 0\.42s/.test(rule(".auth-forms")), true);
check("the panels cross-fade and slide", /transition:\s*opacity 0\.3s ease, transform 0\.42s/.test(panel), true);
check("the off-screen panel parks on the side it comes back from", /\.auth-forms\[data-mode="signin"\] \.auth-panel\[data-panel="signup"\] \{ transform: translateX\(26px\)/.test(css), true);
check("in both directions", /\.auth-forms\[data-mode="signup"\] \.auth-panel\[data-panel="signin"\] \{ transform: translateX\(-26px\)/.test(css), true);
// The fallback floors are for the first paint only. Left on afterwards they outrank the inline height.
check("the fallback height is gated on not having measured", /\.auth-forms:not\(\[data-ready\]\)\[data-mode="signin"\] \{ min-height/.test(css), true);
check("an ungated floor cannot come back", /\.auth-forms\[data-mode="signin"\] \{ min-height/.test(css), false);
check("the reset card's panel is simply on", /\.auth-forms\[data-mode="reset"\] \.auth-panel \{ opacity: 1/.test(css), true);

/* ------------------------------------------------------------------------ the seam stays aligned */
// The toggle is centred on the boundary between the two halves, so its 44% and the grid's columns are
// one measurement written twice. Change one without the other and it drifts off the seam.
check("the toggle sits at 44%", /left:\s*44%;/.test(rule(".auth-toggle")), true);
check("the brand half is 0.88fr of 2fr", /grid-template-columns:\s*minmax\(0, 0\.88fr\) minmax\(0, 1\.12fr\)/.test(rule(".auth-split")), true);
check("which is the same 44%", Math.round((0.88 / (0.88 + 1.12)) * 100), 44);
check("the toggle turns as the panels swap", /\.auth-split\[data-mode="signup"\] \.auth-toggle \{ transform: translate\(-50%, -50%\) rotate\(180deg\)/.test(css), true);
// Phone: the brand half becomes a banner and the toggle moves onto its bottom edge.
check("the phone banner is 168px", /grid-template-rows:\s*168px auto/.test(css), true);
check("and the toggle moves with it", /\.auth-toggle \{ left: 50%; top: 168px;/.test(css), true);

/* --------------------------------------------------------------------- and it can be switched off */
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
check("reduced motion zeroes the transitions", /transition-duration:\s*0\.001ms !important/.test(reduced), true);
check("and the animations", /animation-duration:\s*0\.001ms !important/.test(reduced), true);

/* ------------------------------------------------------------- the forgotten-password step */
check("sign-in offers a recovery link", card.includes("Forgot password?"), true);
check("which asks Supabase to send it", card.includes("resetPasswordForEmail("), true);
// The two halves of the link: the email returns to the callback, and the callback knows to forward to
// the password form. This string is the whole reason a recovery link lands on the right page.
check(
  "the link returns to the callback, which forwards to the reset page",
  card.includes("`${window.location.origin}/auth/callback?next=/reset-password`"),
  true,
);
check("the reader is told to open it in the same browser", /PKCE|same browser|Open it in this browser/i.test(card), true);
check("and that a link is single use", /only\s+be used once|can only be used once/.test(card.replace(/\s+/g, " ")), true);
// The reset page does not trust the arrival: it asks for the session before it draws a password form.
check("the reset page exists", resetPage.includes("<ResetPasswordCard />"), true);
check("and asks for the session first", card.includes("auth.getUser()"), true);
check("only then offering the form", card.includes('setStage(data.user ? "form" : "sent")'), true);
check("a spent link offers a fresh one", card.includes('heading="That link has expired"'), true);
// The reset page is one panel, so a lit dot there would say "sign-in" on a page that is not the form
// it points at. The shared send form lights one only when it is standing in for the sign-in panel.
check("the reset page's own headings carry no dots", /<PanelHead title="Set a new password" subtitle="[^"]*" \/>/.test(card), true);
check("nor does its fresh-link form", /heading="That link has expired"[\s\S]{0,300}?dots=/.test(card), false);
// Going back from the step inside the sign-in panel has to be a state change: a link to /login would
// reload the page the reader is already on and lose the panel they were looking at.
check("the panel's back step does not navigate", card.includes("onClick={() => setForgot(false)}"), true);
// And the step has to open even when the address field is empty — which is exactly how it broke: seeded
// from the field, a click on a fresh form set it to "" and the link did nothing at all.
check(
  "the step opens with an empty address",
  /function openForgot\(\) \{\s*setRecoveryEmail\(email\);\s*setForgot\(true\);\s*\}/.test(card) && card.includes("onClick={openForgot}"),
  true,
);
check("and it can be opened again after going back", card.includes("setForgot(false)") && card.includes("setForgot(true)"), true);
check("saving writes the new password", card.includes("updateUser({ password })"), true);
check("and the two passwords are compared", card.includes("The two passwords do not match."), true);
// A recovery session that died between opening the page and saving has to land back on the explanation.
check("an expired recovery session is recognised", card.includes("isStaleSession(error.message)"), true);
// The token cache belongs to the session that just ended; leaving it would hand the next page its rows.
check("the new password clears the cached rows", /updateUser\(\{ password \}\)[\s\S]{0,700}?clear\(\);/.test(card), true);

/* ----------------------------------------------------------------- the callback honours `next` */
check("the callback reads the destination", callback.includes('safeNextPath(url.searchParams.get("next"), url.origin)'), true);
check("and forwards a refused link's reason", callback.includes('url.searchParams.get("error_description")'), true);
check("a failed exchange goes to the destination, not the dashboard", /if \(error\) return fail\(error.message\)/.test(callback), true);
check("the dashboard is still the default", (callback.match(/next \?\? "\/"/g) ?? []).length, 2);

/* ------------------------------------------------------------ the `next` rule, run rather than read */
// Anything a link can carry is decided here, so these are executable: an open redirect on an auth route
// is how a phishing mail borrows the domain it is trusted under.
check("a plain path is allowed", safeNextPath("/reset-password", ORIGIN), "/reset-password");
check("a path with state keeps it", safeNextPath("/reset-password?from=email", ORIGIN), "/reset-password?from=email");
check("the root is allowed", safeNextPath("/", ORIGIN), "/");
check("a protocol-relative host is refused", safeNextPath("//evil.example", ORIGIN), "null");
check("so is an absolute one", safeNextPath("https://evil.example/steal", ORIGIN), "null");
check("a backslash trick is refused", safeNextPath("/\\evil.example", ORIGIN), "null");
check("a scheme with no slashes is refused", safeNextPath("javascript:alert(1)", ORIGIN), "null");
check("a relative path that is not rooted is refused", safeNextPath("reset-password", ORIGIN), "null");
check("nothing is nothing", safeNextPath(null, ORIGIN), "null");
check("and empty is nothing", safeNextPath("", ORIGIN), "null");
// A destination that resolves elsewhere through a dot segment rather than a host is still elsewhere —
// the origin check is what catches it, not the string prefix.
check("a path that climbs out is still this origin", safeNextPath("/../reset-password", ORIGIN), "/reset-password");

/* --------------------------------------------------------- a dead session, and how it is recognised */
check("a chunked auth cookie counts", carriesAuthCookie(["sb-abcdef-auth-token.0", "sb-abcdef-auth-token.1"]), true);
check("so does an unchunked one", carriesAuthCookie(["sb-abcdef-auth-token"]), true);
check("an unrelated cookie does not", carriesAuthCookie(["NEXT_LOCALE", "theme"]), false);
check("nor a name that merely starts the same way", carriesAuthCookie(["sb-auth-token-store"]), false);
check("and no cookies at all is not a session", carriesAuthCookie([]), false);
check("an expired token is a dead session", isStaleSession("JWT expired"), true);
check("so is one that will not verify", isStaleSession("JWT verification failed"), true);
check("and a revoked refresh token", isStaleSession("Invalid Refresh Token: Refresh Token Not Found"), true);
check("or a session that was never there", isStaleSession("Auth session missing!"), true);
check("PostgREST's own code counts too", isStaleSession("PGRST301"), true);
check("case does not matter", isStaleSession("jwt expired"), true);
// Everything below is a *transient* failure. Signing somebody out over one of these would throw away
// what they had typed for no reason, so the rule has to stay narrow.
check("a dropped connection is not a dead session", isStaleSession("TypeError: Failed to fetch"), false);
check("nor a timeout", isStaleSession("Request timed out after 10000ms"), false);
check("nor a missing function", isStaleSession("Could not find the function public.me()"), false);
check("nor a row the database refused", isStaleSession("permission denied for table trades"), false);
check("nor nothing at all", isStaleSession(null), false);

/* ------------------------------------------------------- where a dead session lands, and what it says */
check("the sentence exists and reads like one", SESSION_ENDED.endsWith("."), true);
// No auth cookie means a first-time visitor, who is owed no explanation for being asked to sign in.
check(
  "the middleware explains only a session it can see the cookie for",
  /if \(carriesAuthCookie\(request\.cookies\.getAll\(\)\.map\(cookie => cookie\.name\)\)\) \{\s*url\.searchParams\.set\("error", SESSION_ENDED\)/.test(middleware),
  true,
);
check("and does not carry the page's own query along", middleware.includes('url.search = "";'), true);
check("the shell catches the other half", shell.includes("isStaleSession(me.error)"), true);
check("by signing the dead session out", /signOut\(\)[\s\S]{0,200}clear\(\);/.test(shell) || /signOut\(\)[\s\S]{0,400}clear\(\);/.test(shell), true);
check("then landing on the auth page with the reason", shell.includes("`/login?error=${encodeURIComponent(SESSION_ENDED)}`"), true);
// The recovery session *is* signed in, so the middleware must not treat the reset page as a page to
// bounce away from — that redirect would swallow the password form the link was sent for.
check(
  "the signed-in redirect names only the two auth panels",
  /pathname === "\/login" \|\| request\.nextUrl\.pathname === "\/signup"/.test(middleware),
  true,
);
check("and never the reset page", /=== "\/reset-password"/.test(middleware.slice(middleware.indexOf("user &&"))), false);
check("the reset page renders without the journal's chrome", shell.includes('"/reset-password"'), true);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll auth checks passed");
process.exit(failures ? 1 : 0);
