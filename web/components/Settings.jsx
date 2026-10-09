'use client';

import { useState } from 'react';
import * as api from '@/lib/api';
import { Icon } from '@/components/ui';

// Auto-lock is picked from a fixed list, so a typo can no longer switch it
// off (the old number field saved 0 = never for -5 or an empty box). A stored
// value that isn't on the list gets its own option.
const AUTOLOCK_CHOICES = [1, 5, 15, 30, 60, 240];

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

  async function changeMaster() {
    setMsg(null);
    if (newPw.length < 10) return setMsg({ text: 'New password must be at least 10 characters.' });
    if (newPw !== newPw2) return setMsg({ text: 'New passwords do not match.' });
    setBusy(true);
    try {
      await onChangeMaster(oldPw, newPw);
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      setMsg({ text: 'Master password changed.', ok: true });
    } catch {
      setMsg({ text: 'Current master password is incorrect.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ maxWidth: 520 }}>
      <header className="topbar">
        <button className="btn icon" onClick={onBack}><Icon name="back" /></button>
        <h2>Settings</h2>
      </header>

      <section>
        <h3>Account</h3>
        <p className="muted">Signed in as {profile?.email} ({profile?.role?.replace('_', ' ')})</p>
        <div className="row">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
          <button
            className="btn"
            onClick={async () => {
              await api.rest(`/profiles?id=eq.${uid}`, { method: 'PATCH', body: { display_name: name.trim() } });
              showToast('Name saved');
            }}
          >
            Save
          </button>
        </div>
      </section>

      <section>
        <h3>Appearance</h3>
        <div className="row">
          <span className="muted" style={{ flex: 1 }}>Theme</span>
          <select value={settings.theme || 'light'} onChange={(e) => setTheme(e.target.value)}>
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
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="Current master password" autoComplete="off" />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New master password" autoComplete="off" />
          <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} placeholder="Confirm new master password" autoComplete="off" />
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
