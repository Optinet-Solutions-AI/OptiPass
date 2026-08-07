'use client';

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';

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

  // Signup links carry ?invite=CODE&email=... - prefill both so the
  // new teammate only chooses a password.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('invite')) {
      setMode('signup');
      setInvite(p.get('invite'));
      if (p.get('email')) setEmail(p.get('email'));
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

  async function submitMaster() {
    setError(null);
    if (pw.length < 10) return setError('Master password must be at least 10 characters.');
    if (pw !== pw2) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await onMasterSetup(pw);
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
    const score = strengthOf(pw);
    return (
      <div className="screen" style={{ maxWidth: 460 }}>
        <Brand
          title="Create your master password"
          sub="This encrypts everything and never leaves your device - not even our server can read your vault. It cannot be recovered if forgotten."
        />
        <label>Master password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 10 characters" autoComplete="new-password" />
        <div className="strength">
          <div style={{ width: `${(score / 5) * 100}%`, background: STRENGTH_COLORS[score] }} />
        </div>
        <label>Confirm master password</label>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {error && <div className="error">{error}</div>}
        <button className="btn primary full" disabled={busy} onClick={submitMaster}>
          {busy ? 'Setting up encryption...' : 'Set master password'}
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
        sub={signup ? 'Create your team account. An admin must approve you unless you have an invite code.' : 'Sign in with your team account.'}
      />
      <label>Email</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@optinetsolutions.com" autoComplete="username" />
      <label>Account password</label>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !signup && submitLogin()}
        autoComplete={signup ? 'new-password' : 'current-password'}
      />
      {signup && (
        <>
          <label>Confirm account password</label>
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
          <label>Invite code (required to join)</label>
          <input type="text" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="e.g. 4f9a1c2b7d3e5a08" autoComplete="off" />
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
