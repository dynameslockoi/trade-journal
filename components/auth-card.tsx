"use client";

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BarChart3, ChevronRight, KeyRound, Lock, Mail, ShieldCheck, User, WalletCards } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { checkInviteCode, isMissingSchema, loadMe } from "@/lib/admin";
import { accessState, normalizeInviteCode } from "@/lib/access";
import { isStaleSession } from "@/lib/session";
import { toISODate, today } from "@/lib/dates";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clear } from "@/lib/query-cache";

export type AuthMode = "signin" | "signup";

/**
 * One page for both halves of signing in.
 *
 * The two forms were separate pages that looked alike but could not share a frame, so moving between
 * them was a navigation — a blank beat, then a full repaint of almost the same card. Here the frame
 * is written once and the forms are two panels inside it: switching is a state change, which is what
 * makes it animatable, and `/login` and `/signup` both still resolve to it so every existing link and
 * redirect keeps working.
 *
 * The panels are different heights (sign-up carries an invitation code and a display name), so the
 * container's height is measured from whichever panel is on screen and transitioned — without that,
 * the card would jump by a hundred pixels in the middle of the cross-fade.
 */
export function AuthCard({ initialMode = "signin" }: { initialMode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);

  const panelRefs = useRef<Partial<Record<AuthMode, HTMLElement | null>>>({});
  const height = usePanelHeight(() => panelRefs.current[mode], mode);

  const switchTo = (next: AuthMode) => {
    setMode(next);
    // Keep the address bar honest: a refresh should land on the panel you are looking at, and a
    // sign-up link somebody kept still opens on sign-up.
    window.history.replaceState(null, "", next === "signup" ? "/signup" : "/login");
  };

  return (
    <AuthFrame
      mode={mode}
      toggle={
        /* A child of the card, not of the brand half: it is placed against the seam at 44% of the
           whole card, and inside the aside that percentage would resolve against the aside instead. */
        <button
          type="button"
          className="auth-toggle"
          onClick={() => switchTo(mode === "signin" ? "signup" : "signin")}
          aria-label={mode === "signin" ? "Create an account" : "Sign in instead"}
        >
          <ChevronRight size={17} aria-hidden />
        </button>
      }
    >
      <div
        className="auth-forms"
        data-mode={mode}
        data-ready={height === undefined ? undefined : ""}
        style={{ height: height === undefined ? undefined : `${height}px` }}
      >
        <section
          className="auth-panel"
          data-panel="signin"
          ref={el => { panelRefs.current.signin = el; }}
          inert={mode !== "signin"}
          aria-hidden={mode !== "signin"}
        >
          <SignInForm onSwitch={() => switchTo("signup")} />
        </section>
        <section
          className="auth-panel"
          data-panel="signup"
          ref={el => { panelRefs.current.signup = el; }}
          inert={mode !== "signup"}
          aria-hidden={mode !== "signup"}
        >
          <SignUpForm onSwitch={() => switchTo("signin")} />
        </section>
      </div>
    </AuthFrame>
  );
}

/**
 * The card a recovery link lands on: the new password, and nothing else.
 *
 * It shares the frame with the sign-in page on purpose. A recovery link is still part of signing in,
 * so it should not look like a different site — and the brand half is the one thing the reader can
 * recognise when the email arrived unexpectedly.
 *
 * The page has to work out whether the link actually got through, because the two failures are
 * silent otherwise: a code that expired, one already used, or a link opened in a browser where the
 * PKCE verifier was never stored all arrive here looking identical — a page with no session. So the
 * session is asked for rather than assumed, and when there is none the page says so and offers a
 * fresh link instead of presenting a password form that cannot save.
 */
export function ResetPasswordCard() {
  const [stage, setStage] = useState<"checking" | "form" | "sent" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const panel = useRef<HTMLElement | null>(null);
  const height = usePanelHeight(() => panel.current, stage);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = await browserClient();
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      // Back to "sent" rather than "form" when the cookie is there but dead: the message fits, and
      // the address field is the right next step either way.
      setStage(data.user ? "form" : "sent");
    })();
    return () => { alive = false; };
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    setLoading(true);
    const supabase = await browserClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      // A recovery session that expired between opening the page and saving lands back on the
      // explanation, which is the only thing that can be acted on.
      setError(isStaleSession(error.message) ? "" : error.message);
      setStage(isStaleSession(error.message) ? "sent" : "form");
      setLoading(false);
      return;
    }
    // Everything the pages were holding belongs to the session before this one.
    clear();
    setLoading(false);
    setStage("done");
  }

  return (
    <AuthFrame mode="reset">
      <div
        className="auth-forms"
        data-mode="reset"
        data-ready={height === undefined ? undefined : ""}
        style={{ height: height === undefined ? undefined : `${height}px` }}
      >
        <section className="auth-panel" data-panel="reset" ref={el => { panel.current = el; }}>
          {stage === "checking" && (
            <div className="auth-form">
              <PanelHead title="Checking your link" subtitle="One moment." />
              <p className="auth-foot muted"><span className="spinner" aria-hidden /> Verifying the recovery link…</p>
            </div>
          )}

          {stage === "form" && (
            <form onSubmit={save} className="auth-form">
              <PanelHead title="Set a new password" subtitle="Then you are back in your journal." />
              <div className="auth-fields">
                <Field id="reset-password" label="New password" icon={<Lock size={14} />} hint="At least 8 characters.">
                  <Input
                    id="reset-password" type="password" autoComplete="new-password"
                    minLength={8} required value={password} onChange={e => setPassword(e.target.value)}
                  />
                </Field>
                <Field id="reset-confirm" label="Confirm password" icon={<Lock size={14} />}>
                  <Input
                    id="reset-confirm" type="password" autoComplete="new-password"
                    required value={confirm} onChange={e => setConfirm(e.target.value)}
                  />
                </Field>
              </div>
              {error && <Alert variant="error" className="auth-alert">{error}</Alert>}
              <SubmitButton loading={loading} label="Save password" busyLabel="Saving…" />
              <p className="auth-foot muted">
                <a className="auth-link" href="/login">Back to sign in</a>
              </p>
            </form>
          )}

          {stage === "sent" && (
            <ResetLinkForm
              email={email}
              onEmail={setEmail}
              onSent={() => setStage("done")}
              heading="That link has expired"
              blurb="A recovery link can only be used once, and only in the browser that asked for it. Enter your email and a fresh one will be sent."
              cta="Send a new link"
              back={<a className="auth-link" href="/login">Back to sign in</a>}
            />
          )}

          {stage === "done" && (
            <div className="auth-form">
              <PanelHead title="You are all set" subtitle="Your password has been changed." />
              <Alert variant="success" className="auth-alert">
                If this account was not yours, sign in and change the password again now.
              </Alert>
              <Button asChild className="auth-submit"><a href="/">Continue to your journal</a></Button>
            </div>
          )}
        </section>
      </div>
    </AuthFrame>
  );
}

/**
 * Ask for a fresh recovery link, from either place that can need one: the sign-in panel's "Forgot
 * password?" step, and the reset page when its own link turned out to be spent.
 *
 * The link is pointed at `/auth/callback` with `next=/reset-password`, the same shape Supabase's own
 * Next.js guide uses, so the code exchange happens on the server — where the session cookie can be
 * written — and the reader still ends up on the password form rather than the dashboard.
 */
async function sendRecoveryLink(email: string): Promise<string | null> {
  const supabase = await browserClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
  });
  return error ? error.message : null;
}

/** The email-and-send form, shared by the sign-in panel's forgotten-password step and the reset page. */
function ResetLinkForm({
  email,
  onEmail,
  onSent,
  heading,
  blurb,
  cta,
  back,
  dots,
}: {
  email: string;
  onEmail: (value: string) => void;
  onSent: () => void;
  heading: string;
  blurb: string;
  cta: string;
  /** Where "back" goes — a link on the reset page, a state change inside the sign-in panel. */
  back: React.ReactNode;
  /** Lit only when this form is standing in for the sign-in panel; the reset page has no panels. */
  dots?: AuthMode;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const failure = await sendRecoveryLink(email);
    setLoading(false);
    if (failure) { setError(failure); return; }
    onSent();
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <PanelHead title={heading} subtitle={blurb} mode={dots} />
      <div className="auth-fields">
        <Field id="recovery-email" label="Email" icon={<Mail size={14} />}>
          <Input
            id="recovery-email" type="email" autoComplete="email"
            required value={email} onChange={e => onEmail(e.target.value)}
          />
        </Field>
      </div>
      {error && <Alert variant="error" className="auth-alert">{error}</Alert>}
      <SubmitButton loading={loading} label={cta} busyLabel="Sending…" />
      <p className="auth-foot muted">{back}</p>
    </form>
  );
}

/**
 * The page surface, the card and the brand half — everything the sign-in page and the reset page
 * draw identically. The brand half is the one part worth sharing as markup rather than duplicating:
 * it is the only thing a reader arriving from an unexpected email can recognise.
 */
function AuthFrame({ mode, toggle, children }: { mode: string; toggle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-split" data-mode={mode}>
        <AuthAside />
        {toggle}
        <div className="auth-main">{children}</div>
      </div>
    </main>
  );
}

function AuthAside() {
  return (
    <aside className="auth-aside">
      <div className="auth-aside-body">
        <div className="auth-mark" aria-hidden>T</div>
        <div className="auth-aside-title">Trading Journal</div>
        <p className="auth-aside-copy">
          A private record of every Bursa trade — kept in your own Supabase project, read by nobody else.
        </p>
        <ul className="auth-points">
          <li><WalletCards size={14} aria-hidden /> Fees, R multiples and screenshots on every row</li>
          <li><BarChart3 size={14} aria-hidden /> Which set-ups, sectors and hours actually pay</li>
          <li><ShieldCheck size={14} aria-hidden /> Invitation only, and your data stays yours</li>
        </ul>
      </div>
    </aside>
  );
}

/**
 * The height of the panel currently on screen, measured before paint and re-measured whenever its
 * content changes — an error message arriving is a height change too, and it should push the card
 * open rather than clip. `key` is what the caller's panel depends on (the mode, or the stage), and
 * changing it re-measures at once so the box animates from the old height to the new one.
 */
function usePanelHeight(get: () => HTMLElement | null | undefined, key: unknown): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  // The lookup is read through a ref so the effect can depend on `key` alone: `get` is a fresh
  // closure every render, and depending on it would tear the observer down and rebuild it on every
  // keystroke, which is the one thing that would make the measurement miss.
  const lookup = useRef(get);
  lookup.current = get;
  useLayoutEffect(() => {
    const el = lookup.current();
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [key]);
  return height;
}

/**
 * Heading, mode dots and the switch line, so the two panels read as the same page.
 *
 * `mode` is optional because the reset page is a single panel: it has no second half to point at, and
 * a lit dot there would say "sign-in" on a page that is not the sign-in form.
 */
function PanelHead({ title, subtitle, mode }: { title: React.ReactNode; subtitle: string; mode?: AuthMode }) {
  return (
    <div className="auth-head">
      <h1>{title}</h1>
      <p className="auth-sub muted">{subtitle}</p>
      {mode && (
        <div className="auth-dots" aria-hidden>
          <span className={mode === "signin" ? "on" : undefined} />
          <span className={mode === "signup" ? "on" : undefined} />
        </div>
      )}
    </div>
  );
}

/** A labelled field with its icon inside the control, as the design draws them. */
function Field({
  id,
  label,
  icon,
  children,
  hint,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="auth-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="auth-input">
        <span className="auth-input-icon" aria-hidden>{icon}</span>
        {children}
      </div>
      {hint && <div className="auth-hint muted">{hint}</div>}
    </div>
  );
}

/** The button's own loading state: a spinner beside the label, so the wait reads as work. */
function SubmitButton({ loading, label, busyLabel }: { loading: boolean; label: string; busyLabel: string }) {
  return (
    /* `type="submit"` is stated rather than relied on: the panel also holds the "Forgot password?"
       step's buttons, and one of them losing its own `type` would silently turn it into a second
       submit for the form behind it. */
    <Button type="submit" className="auth-submit" disabled={loading} aria-busy={loading}>
      {loading && <span className="spinner" aria-hidden />}
      {loading ? busyLabel : label}
    </Button>
  );
}

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** The link in the recovery email has been asked for and sent. */
  const [sent, setSent] = useState(false);
  /**
   * The recovery step is the sign-in panel's own — a second panel would need a third dot, a third
   * height and a toggle that means nothing. So the forgotten-password form replaces the credentials
   * form inside this panel and comes back.
   *
   * The step is a flag, not the address it was opened with: seeded from the field instead, clicking the
   * link on a fresh form would set it to an empty string and the step would never open at all.
   */
  const [forgot, setForgot] = useState(false);
  /** Carried over from the form so an address already typed does not have to be typed twice. */
  const [recoveryEmail, setRecoveryEmail] = useState("");

  function openForgot() {
    setRecoveryEmail(email);
    setForgot(true);
  }

  // `/auth/callback` and the middleware send a failed link or a dead session here with its reason, so
  // it reads as one instead of a silent bounce to a login form with no explanation.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason) setError(reason);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = await browserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // A suspended or expired account is refused here too, not only by the app shell: signing in and
    // then being bounced by the first page reads as a bug rather than as a decision, and the session
    // would otherwise be left live behind it. The sign-out is a courtesy to the *database* as much as
    // the person — nothing is trusted to it.
    try {
      const state = accessState(await loadMe(), toISODate(today()));
      if (!state.ok) {
        await supabase.auth.signOut();
        setError(state.detail);
        setLoading(false);
        return;
      }
    } catch {
      // `supabase/admin.sql` has not been run, so there is no access state to enforce.
    }
    window.location.href = "/";
  }

  if (forgot) {
    return sent ? (
      <div className="auth-form">
        <PanelHead title="Check your email" subtitle={`A recovery link is on its way, if ${recoveryEmail.trim()} has an account.`} mode="signin" />
        <Alert variant="success" className="auth-alert">
          Open it in this browser and you will land on a page to set a new password. The link can only
          be used once.
        </Alert>
        <Button className="auth-submit" type="button" onClick={() => { setForgot(false); setSent(false); }}>
          Back to sign in
        </Button>
      </div>
    ) : (
      <ResetLinkForm
        email={recoveryEmail}
        onEmail={setRecoveryEmail}
        onSent={() => setSent(true)}
        heading="Forgot your password?"
        blurb="Enter the address on the account and a recovery link will be sent to it."
        cta="Email me a link"
        dots="signin"
        /* Inside the sign-in panel this is a step, not a page, so going back is a state change
           rather than a navigation to the page we are already on. */
        back={
          <button type="button" className="auth-link" onClick={() => setForgot(false)}>
            Back to sign in
          </button>
        }
      />
    );
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <PanelHead title="Welcome back!" subtitle="Sign in to your private trading journal." mode="signin" />
      <div className="auth-fields">
        <Field id="login-email" label="Email" icon={<Mail size={14} />}>
          <Input id="login-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field id="login-password" label="Password" icon={<Lock size={14} />}>
          <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
      </div>
      <div className="auth-links">
        <button type="button" className="auth-link" onClick={openForgot}>Forgot password?</button>
      </div>
      {error && <Alert variant="error" className="auth-alert">{error}</Alert>}
      <SubmitButton loading={loading} label="Sign in" busyLabel="Signing in…" />
      <p className="auth-foot muted">
        Don't have an account?{" "}
        <button type="button" className="auth-link" onClick={onSwitch}>Register</button>
      </p>
    </form>
  );
}

function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
    const code = normalizeInviteCode(invite);
    if (!code) { setError("Enter the invitation code you were given."); setLoading(false); return; }
    const supabase = await browserClient();
    try {
      const check = await checkInviteCode(code);
      if (!check.ok) {
        setError(check.reason ?? "That invitation code cannot be used.");
        setLoading(false);
        return;
      }
    } catch (err) {
      // `supabase/admin.sql` has not been run on this project, so there are no codes and no gate.
      // Anything else is a real failure and blocking the signup would be the wrong answer to it.
      const message = err instanceof Error ? err.message : String(err);
      if (!isMissingSchema(message)) { setError(message); setLoading(false); return; }
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name, invite_code: code } },
    });
    if (error) setError(/database error/i.test(error.message) ? "That invitation code could not be accepted. Check it, or ask for a fresh one." : error.message);
    else if (data.session) window.location.href = "/";
    else setMessage("Account created. Check your email to confirm your address, then sign in.");
    setLoading(false);
  }

  return (
    <form onSubmit={submit} className="auth-form">
      <PanelHead title="Register now, it's free!" subtitle="Invitation only. Your trading data stays in your Supabase project." mode="signup" />
      <div className="auth-fields">
        <Field
          id="signup-invite" label="Invitation code" icon={<KeyRound size={14} />}
          hint="Dashes, spaces and capitals do not matter. Ask for a new code if yours is refused."
        >
          <Input id="signup-invite" required autoComplete="off" value={invite} onChange={e => setInvite(e.target.value)} placeholder="e.g. BURSA2026" />
        </Field>
        <Field id="signup-name" label="Display name" icon={<User size={14} />}>
          <Input id="signup-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Trader" />
        </Field>
        <Field id="signup-email" label="Email" icon={<Mail size={14} />}>
          <Input id="signup-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field id="signup-password" label="Password" icon={<Lock size={14} />}>
          <Input id="signup-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
      </div>
      {error && <Alert variant="error" className="auth-alert">{error}</Alert>}
      {message && <Alert variant="success" className="auth-alert">{message}</Alert>}
      <SubmitButton loading={loading} label="Create account" busyLabel="Creating…" />
      <p className="auth-foot muted">
        Already registered?{" "}
        <button type="button" className="auth-link" onClick={onSwitch}>Sign in</button>
      </p>
    </form>
  );
}
