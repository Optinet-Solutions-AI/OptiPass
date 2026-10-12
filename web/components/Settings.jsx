'use client';

import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { Icon } from '@/components/ui';

// Auto-lock is picked from a fixed list, so a typo can no longer switch it
// off (the old number field saved 0 = never for -5 or an empty box). A stored
// value that isn't on the list gets its own option.
const AUTOLOCK_CHOICES = [1, 5, 15, 30, 60, 240];

// Same rule as the guide's advice ("use 12+ characters").
const MASTER_MIN_LENGTH = 12;

function autoLockLabel(minutes) {
  if (!minutes) return 'Never';
  if (minutes % 60 === 0) return minutes === 60 ? '1 hour' : `${minutes / 60} hours`;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export default function Settings({
  profile,
  settings,
  setSettings,
  setTheme,
  setProfile,
  showToast,
  uid,
  onChangeMaster,
  onSignOut,
  onOpenGuide,
  onBack,
}) {
  const [name, setName] = useState(profile?.display_name || '');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameTimer = useRef(null);
  const savedName = useRef(profile?.display_name || '');

  // Every setting saves as you change it and says so - no Save buttons.
  // The name saves a moment after typing stops, or on Enter / leaving the field.
  async function saveName(value = name) {
    clearTimeout(nameTimer.current);
    const display_name = value.trim();
    const before = savedName.current;
    if (display_name === before) return;
    savedName.current = display_name; // set first so overlapping triggers don't save twice
    try {
      await api.rest(`/profiles?id=eq.${uid}`, { method: 'PATCH', body: { display_name } });
      setProfile((p) => (p ? { ...p, display_name } : p));
      showToast(display_name ? `Saved - teammates see you as "${display_name}"` : 'Saved - teammates see your email');
    } catch (err) {
      savedName.current = before;
      showToast(err.message);
    }
  }
  useEffect(() => () => clearTimeout(nameTimer.current), []);

  async function changeMaster() {
    setMsg(null);
    if (newPw.length < MASTER_MIN_LENGTH) {
      return setMsg({ text: `The new master password must be at least ${MASTER_MIN_LENGTH} characters.` });
    }
    if (newPw !== newPw2) return setMsg({ text: 'New passwords do not match.' });
    setBusy(true);
    try {
      await onChangeMaster(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      setMsg({ text: 'Master password changed.', ok: true });
    } catch (err) {
      // Only a failed decrypt means a wrong password; a save problem leaves the old one working.
      setMsg({
        text:
          err.code === 'WRONG_MASTER'
            ? 'Current master password is incorrect.'
            : `Couldn't change the master password - your current one still works. ${err.message}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ maxWidth: 520 }}>
      <header className="topbar">
        <button className="btn icon" title="Back" aria-label="Back" onClick={onBack}><Icon name="back" /></button>
        <h2>Settings</h2>
      </header>
      <p className="muted settings-note">Changes save automatically.</p>

      <section>
        <h3>Account</h3>
        <p className="muted">Signed in as {profile?.email} ({profile?.role?.replace('_', ' ')})</p>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            clearTimeout(nameTimer.current);
            nameTimer.current = setTimeout(() => saveName(v), 1000);
          }}
          onBlur={() => saveName()}
          onKeyDown={(e) => e.key === 'Enter' && saveName()}
          placeholder="Display name"
          aria-label="Display name"
        />
      </section>

      <section>
        <h3>Appearance</h3>
        <div className="row">
          <label className="inline muted" htmlFor="set-theme" style={{ flex: 1, margin: 0, color: 'var(--muted)' }}>Theme</label>
          <select
            id="set-theme"
            value={settings.theme || 'light'}
            onChange={(e) => {
              setTheme(e.target.value);
              showToast(`Saved - ${e.target.value} theme`);
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>

      <section>
        <h3>Auto-lock</h3>
        <div className="row">
          <label className="inline muted" htmlFor="set-autolock" style={{ flex: 1, margin: 0, color: 'var(--muted)' }}>Lock after inactivity</label>
          <select
            id="set-autolock"
            value={String(settings.autoLockMinutes)}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              setSettings({ ...settings, autoLockMinutes: minutes });
              showToast(
                minutes === 0
                  ? 'Auto-lock off - OptiPass stays unlocked until you lock it'
                  : `Saved - locks after ${autoLockLabel(minutes)} without activity`
              );
            }}
          >
            {[...new Set([...AUTOLOCK_CHOICES, settings.autoLockMinutes])]
              .filter((m) => m > 0)
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>{autoLockLabel(m)}</option>
              ))}
            <option value="0">Never</option>
          </select>
        </div>
      </section>

      <section>
        <h3>Change master password</h3>
        <div className="stack">
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="Current master password" aria-label="Current master password" autoComplete="off" />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New master password (12+ characters)" aria-label="New master password" autoComplete="off" />
          <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Confirm new master password" aria-label="Confirm new master password" autoComplete="off" />
        </div>
        {msg && <div className={`error${msg.ok ? ' ok' : ''}`}>{msg.text}</div>}
        <button className="btn full" disabled={busy} onClick={changeMaster}>
          {busy ? 'Re-encrypting...' : 'Change password'}
        </button>
      </section>

      <section>
        <h3>Chrome extension</h3>
        <button className="btn full" onClick={onOpenGuide}>Extension setup guide</button>
      </section>

      <section>
        <h3>Session</h3>
        <button className="btn danger full" onClick={onSignOut}>Sign out</button>
      </section>
    </div>
  );
}
