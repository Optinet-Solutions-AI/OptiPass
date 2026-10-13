'use client';

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { generatePassphrase } from '@/lib/crypto';

function Brand({ title, sub }) {
  return (
    <div className="brand">
      <div className="brand-logo">O</div>
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}

function strengthOf(pw) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return score;
}

const STRENGTH_COLORS = ['#b4544a', '#b4544a', '#c9a227', '#c9a227', '#6b8f71', '#6b8f71'];

export default function Auth({ screen, profile, notice, onNoticeShown, onBoot, onSignOut, onMasterSetup, onUnlock, showToast }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const [fromLink, setFromLink] = useState(false);

  // Signup links carry ?invite=CODE&email=... - prefill and lock both
  // so the new teammate only chooses a password.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('invite')) {
      setMode('signup');
      setInvite(p.get('invite'));
      if (p.get('email')) setEmail(p.get('email'));
      setFromLink(true);
    }
  }, []);

  // The server ended the session (e.g. it expired): say so instead of
  // dropping the user on a blank sign-in form.
  useEffect(() => {
    if (screen !== 'login') return;
    const expired = api.takeExpiredSession();
    if (!expired) return;
    if (expired.email) setEmail(expired.email);
    setMode('signin');
    setOk(false);
    setError('Your session expired - please sign in again.');
  }, [screen]);

  // An expired or already-used reset link: offer to send a new one.
  useEffect(() => {
    if (screen !== 'login' || !notice) return;
    setMode('forgot');
    setOk(false);
    setError(notice);
    onNoticeShown?.();
  }, [screen, notice, onNoticeShown]);

  // "Forgot account password?" - Supabase emails a link back to this app.
  async function submitForgot() {
    if (busy) return;
    setError(null);
    setOk(false);
    if (!email.trim()) return setError('Enter the email address you sign in with.');
    setBusy(true);
    try {
      await api.requestPasswordReset(email.trim());
      setOk(true);
      setError(
        `If ${email.trim()} has an OptiPass account, a reset link is on its way. Open it on this computer to choose a new account password (check spam too).`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Reached from the email link: the user is signed in for this one step.
  async function submitNewPassword() {
    if (busy) return;
    setError(null);
    if (pw.length < 8) return setError('Account password must be at least 8 characters.');
    if (pw !== pw2) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await api.updatePassword(pw);
      api.logEvent('auth.password_reset');
      setPw('');
      setPw2('');
      showToast('Account password changed. Your master password is the same as before.');
      await onBoot();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin() {
    if (busy) return; // already submitting (e.g. Enter pressed twice)
    setError(null);
    setOk(false);
    if (!email || !pw) return setError('Email and password are required.');
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (pw.length < 8) return setError('Account password must be at least 8 characters.');
        if (pw !== pw2) return setError('Passwords do not match.');
        const { signedIn } = await api.signUp(email.trim(), pw, invite.trim() || undefined);
        if (!signedIn) {
          setMode('signin');
          setOk(true);
          return setError('Account created - confirm the email we sent you, then sign in.');
        }
      } else {
        await api.signIn(email.trim(), pw);
      }
      api.logEvent('auth.signin');
      setPw('');
      setPw2('');
      await onBoot();
    } catch (err) {
      setError(err.message); // already plain language (lib/api.js)
    } finally {
      setBusy(false);
    }
  }

  // Enter submits from any field, when signing in and when signing up.
  const onEnter = (e) => e.key === 'Enter' && submitLogin();

  const [generated, setGenerated] = useState('');
  const [savedIt, setSavedIt] = useState(false);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (screen === 'master-setup') {
      setGenerated(generatePassphrase());
      setSavedIt(false);
      setCopied(false);
    }
  }, [screen]);

  async function submitMaster() {
    setError(null);
    setBusy(true);
    try {
      await onMasterSetup(generated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitUnlock() {
    if (!pw) return;
    setError(null);
    setBusy(true);
    try {
      await onUnlock(pw);
      setPw('');
    } catch {
      setError('Incorrect master password.');
    } finally {
      setBusy(false);
    }
  }

  if (screen === 'pending') {
    // Waiting for approval -> "Check again"; disabled -> nothing to wait for, just Sign out.
    const disabled = profile?.status === 'disabled';
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand title={disabled ? 'Account disabled' : 'Almost in'} />
        <div className="notice">
          <p>
            {disabled
              ? "Your account has been disabled, so your vault can't be opened. If you think this is a mistake, contact your OptiPass admin."
              : 'Your account is waiting for an admin to approve it. Ask your admin, then check again.'}
          </p>
        </div>
        {!disabled && <button className="btn primary full" onClick={onBoot}>Check again</button>}
        <button className={disabled ? 'btn primary full' : 'btn link full'} onClick={onSignOut}>Sign out</button>
      </div>
    );
  }

  if (screen === 'master-setup') {
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand
          title="Your master password"
          sub="We generated it for you. It encrypts everything and never leaves your device - not even our server can read your vault."
        />
        <div className="notice">
          <div className="ms-pass">{generated}</div>
          <div className="row">
            <button
              className="btn grow"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(generated);
                  setCopied(true);
                  showToast('Master password copied - store it somewhere safe');
                } catch {
                  showToast("Couldn't copy - select the words above and copy them by hand");
                }
              }}
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setGenerated(generatePassphrase());
                setSavedIt(false);
                setCopied(false); // the copied one is no longer the password
              }}
            >
              Generate another
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          <strong>Save it somewhere safe right now.</strong> You&apos;ll need it to unlock OptiPass
          on any other device or Chrome profile, and <strong>it can never be recovered</strong>.
          Day to day the extension uses a 6-digit PIN instead - and you can change this password
          anytime in Settings.
        </p>
        <label className="checkbox" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={savedIt} onChange={(e) => setSavedIt(e.target.checked)} /> I
          saved my master password somewhere safe
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary full" disabled={busy || !savedIt} onClick={submitMaster}>
          {busy ? 'Setting up encryption...' : 'Continue'}
        </button>
      </div>
    );
  }

  if (screen === 'unlock') {
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand title="Vault locked" sub={`Signed in as ${profile?.email || ''}`} />
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitUnlock()}
          placeholder="Master password"
          aria-label="Master password"
          autoComplete="off"
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary full" disabled={busy} onClick={submitUnlock}>
          {busy ? 'Unlocking...' : 'Unlock'}
        </button>
        <button className="btn link full" onClick={onSignOut}>Sign out</button>
      </div>
    );
  }

  if (screen === 'reset-password') {
    const onEnterNew = (e) => e.key === 'Enter' && submitNewPassword();
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand title="Choose a new account password" sub={profile?.email || 'For signing in to OptiPass.'} />
        <label htmlFor="reset-pw">New account password (8+ characters)</label>
        <input id="reset-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={onEnterNew} autoComplete="new-password" autoFocus />
        <label htmlFor="reset-pw2">Confirm new password</label>
        <input id="reset-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={onEnterNew} autoComplete="new-password" />
        <p className="muted">
          This only changes the password you sign in with. Your <strong>master password</strong> stays the same - you&apos;ll
          still need it to unlock your vault.
        </p>
        {error && <div className="error">{error}</div>}
        <button className="btn primary full" disabled={busy} onClick={submitNewPassword}>
          {busy ? 'Saving...' : 'Save new password'}
        </button>
        <button className="btn link full" onClick={onSignOut}>Cancel</button>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand title="Reset your account password" sub="We'll email you a link to choose a new one." />
        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitForgot()}
          placeholder="you@optinetsolutions.com"
          autoComplete="username"
        />
        <p className="muted">
          This resets the password you sign in with. A forgotten <strong>master password</strong> can&apos;t be reset -
          ask your OptiPass admin for help.
        </p>
        {error && <div className={`error${ok ? ' ok' : ''}`}>{error}</div>}
        <button className="btn primary full" disabled={busy} onClick={submitForgot}>
          {busy ? 'Sending...' : 'Send reset link'}
        </button>
        <button className="btn link full" onClick={() => { setMode('signin'); setError(null); setOk(false); }}>
          Back to sign in
        </button>
      </div>
    );
  }

  // login / signup
  const signup = mode === 'signup';
  return (
    <div className="screen" style={{ maxWidth: 460 }}>
      <Brand
        title="OptiPass"
        sub={
          signup
            ? fromLink
              ? "You're invited! Add your password to complete signup."
              : 'Sign up with the email address your admin invited.'
            : 'Sign in with your team account.'
        }
      />
      <label htmlFor="auth-email">Email</label>
      <input
        id="auth-email"
        type="email"
        onKeyDown={onEnter}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@optinetsolutions.com"
        autoComplete="username"
        readOnly={signup && fromLink}
        style={signup && fromLink ? { opacity: 0.7 } : undefined}
      />
      <label htmlFor="auth-pw">{signup ? 'Create your password' : 'Account password'}</label>
      <input
        id="auth-pw"
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={onEnter}
        autoComplete={signup ? 'new-password' : 'current-password'}
      />
      {signup && (
        <>
          <label htmlFor="auth-pw2">Confirm password</label>
          <input id="auth-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={onEnter} autoComplete="new-password" />
        </>
      )}
      {error && <div className={`error${ok ? ' ok' : ''}`}>{error}</div>}
      <button className="btn primary full" disabled={busy} onClick={submitLogin}>
        {busy ? 'Working...' : signup ? 'Create account' : 'Sign in'}
      </button>
      {!signup && (
        <button className="btn link full" onClick={() => { setMode('forgot'); setError(null); setOk(false); }}>
          Forgot account password?
        </button>
      )}
      <button className="btn link full" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(null); }}>
        {signup ? 'Have an account? Sign in' : 'Need an account? Sign up'}
      </button>
    </div>
  );
}
