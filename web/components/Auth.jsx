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

export default function Auth({ screen, profile, onBoot, onSignOut, onMasterSetup, onUnlock, showToast }) {
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

  async function submitLogin() {
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
      setError(
        /database error/i.test(err.message)
          ? 'An invite code is required to join - ask your admin for one.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  }

  const [generated, setGenerated] = useState('');
  const [savedIt, setSavedIt] = useState(false);

  useEffect(() => {
    if (screen === 'master-setup') {
      setGenerated(generatePassphrase());
      setSavedIt(false);
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
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand title="Almost in" />
        <div className="notice">
          <p>
            {profile?.status === 'disabled'
              ? 'Your account has been disabled. Contact your admin.'
              : 'Your account is waiting for an admin to approve it. Ask your admin, then check again.'}
          </p>
        </div>
        <button className="btn primary full" onClick={onBoot}>Check again</button>
        <button className="btn link full" onClick={onSignOut}>Sign out</button>
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
                await navigator.clipboard.writeText(generated);
              }}
            >
              Copy
            </button>
            <button
              className="btn"
              onClick={() => {
                setGenerated(generatePassphrase());
                setSavedIt(false);
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
              : 'Sign up with the invite code your admin sent you.'
            : 'Sign in with your team account.'
        }
      />
      {signup && (
        <>
          <label>Invite code</label>
          <input
            type="text"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="e.g. 4f9a1c2b7d3e5a08"
            autoComplete="off"
            readOnly={fromLink}
            style={fromLink ? { opacity: 0.7 } : undefined}
          />
        </>
      )}
      <label>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@optinetsolutions.com"
        autoComplete="username"
        readOnly={signup && fromLink}
        style={signup && fromLink ? { opacity: 0.7 } : undefined}
      />
      <label>{signup ? 'Create your password' : 'Account password'}</label>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !signup && submitLogin()}
        autoComplete={signup ? 'new-password' : 'current-password'}
      />
      {signup && (
        <>
          <label>Confirm password</label>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </>
      )}
      {error && <div className={`error${ok ? ' ok' : ''}`}>{error}</div>}
      <button className="btn primary full" disabled={busy} onClick={submitLogin}>
        {busy ? 'Working...' : signup ? 'Create account' : 'Sign in'}
      </button>
      <button className="btn link full" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(null); }}>
        {signup ? 'Have an account? Sign in' : 'Need an account? Sign up'}
      </button>
    </div>
  );
}
