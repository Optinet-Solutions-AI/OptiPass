'use client';

import { useState } from 'react';
import * as api from '@/lib/api';
import { Icon } from '@/components/ui';

export default function Settings({
  profile,
  settings,
  setSettings,
  setTheme,
  showToast,
  uid,
  onChangeMaster,
  onSignOut,
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
          <span className="muted" style={{ flex: 1 }}>Lock after inactivity (minutes, 0 = never)</span>
          <input
            type="number"
            min="0"
            max="240"
            value={settings.autoLockMinutes}
            onChange={(e) =>
              setSettings({ ...settings, autoLockMinutes: Math.min(240, Math.max(0, parseInt(e.target.value, 10) || 0)) })
            }
          />
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
        <h3>Session</h3>
        <button className="btn danger full" onClick={onSignOut}>Sign out</button>
      </section>
    </div>
  );
}
