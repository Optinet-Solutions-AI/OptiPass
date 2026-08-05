'use client';

import { useState } from 'react';
import { generateTotp } from '@/lib/crypto';
import { Icon, formatMonitorValue, monitorIsLow, timeAgo } from '@/components/ui';

export default function Vault({
  profile,
  settings,
  setTheme,
  showToast,
  memberships,
  items,
  monitors,
  onAdd,
  onEdit,
  onRefreshMonitor,
  onSettings,
  onAdmin,
  onLock,
}) {
  const [query, setQuery] = useState('');
  const [vaultFilter, setVaultFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  const sortedVaults = [...memberships].sort((a, b) => {
    if (a.vaults.type !== b.vaults.type) return a.vaults.type === 'personal' ? -1 : 1;
    return a.vaults.name.localeCompare(b.vaults.name);
  });

  const allTags = [...new Set(items.flatMap((e) => e.data.tags || []))].sort((a, b) =>
    a.localeCompare(b)
  );

  let entries = items.filter(
    (e) =>
      (vaultFilter === 'all' || e.vault_id === vaultFilter) &&
      (tagFilter === 'all' || (e.data.tags || []).includes(tagFilter))
  );
  entries = [...entries].sort((a, b) => (a.data.title || '').localeCompare(b.data.title || ''));
  const q = query.trim().toLowerCase();
  if (q) {
    entries = entries.filter((e) =>
      [e.data.title, e.data.username, e.data.url, e.data.ssoEmail, ...(e.data.tags || [])].some(
        (f) => (f || '').toLowerCase().includes(q)
      )
    );
  }

  const SSO_LABELS = { oauth: 'OAuth', google: 'Google', github: 'GitHub', microsoft: 'Microsoft', apple: 'Apple', sso: 'SSO' };

  async function copy(text, msg) {
    if (!text) return showToast('Nothing to copy');
    await navigator.clipboard.writeText(text);
    showToast(msg);
  }

  async function copyTotp(entry) {
    const t = await generateTotp(entry.data.totp);
    if (!t) return showToast('This entry has an invalid 2FA key');
    await navigator.clipboard.writeText(t.code);
    showToast(`2FA code copied - valid ${t.secondsLeft}s`);
  }

  const isAdmin = ['admin', 'super_admin'].includes(profile?.role);
  const dark = settings.theme === 'dark';

  return (
    <div className="screen">
      <header className="topbar">
        <input type="search" placeholder="Search vault..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn icon" title="Add entry" onClick={onAdd}><Icon name="plus" /></button>
        <button className="btn icon" title="Settings" onClick={onSettings}><Icon name="sliders" /></button>
        <button className="btn icon" title="Lock vault" onClick={onLock}><Icon name="lock" /></button>
      </header>
      <div className="topbar">
        <select value={vaultFilter} onChange={(e) => setVaultFilter(e.target.value)}>
          <option value="all">All vaults</option>
          {sortedVaults.map((m) => (
            <option key={m.vault_id} value={m.vault_id}>{m.vaults.name}</option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="all">All labels</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <button className="btn icon" title="Toggle light / dark" onClick={() => setTheme(dark ? 'light' : 'dark')}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        {isAdmin && <button className="btn" onClick={onAdmin}>Admin</button>}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <p>No entries{q ? ' match' : ' yet'}.</p>
          <p className="muted">Click + to add a login.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => {
            const m = memberships.find((x) => x.vault_id === entry.vault_id);
            const mons = monitors.filter((mon) => mon.item_id === entry.id);
            const writable = m && ['manager', 'editor'].includes(m.role);
            return (
              <li key={entry.id} className="entry">
                <div className="entry-row">
                  <div className="entry-avatar">{(entry.data.title || '?')[0]}</div>
                  <div className="entry-info">
                    <div className="entry-title">{entry.data.title || '(untitled)'}</div>
                    <div className="entry-sub">
                      {entry.data.username || entry.data.ssoEmail || entry.data.url || ''}
                      {entry.data.signinMethod && entry.data.signinMethod !== 'password' && (
                        <span
                          className="badge"
                          title={entry.data.ssoEmail ? `Signs in as ${entry.data.ssoEmail}` : undefined}
                        >
                          via {SSO_LABELS[entry.data.signinMethod] || 'SSO'}
                        </span>
                      )}
                      {m && m.vaults.type === 'shared' && vaultFilter === 'all' && (
                        <span className="badge gray">{m.vaults.name}</span>
                      )}
                      {(entry.data.tags || []).map((t) => (
                        <span key={t} className="badge">{t}</span>
                      ))}
                    </div>
                  </div>
                  <div className="entry-actions">
                    <button className="btn icon" title="Copy username" onClick={() => copy(entry.data.username || entry.data.ssoEmail, entry.data.username ? 'Username copied' : 'SSO account email copied')}><Icon name="user" /></button>
                    {entry.data.password && (
                      <button className="btn icon" title="Copy password" onClick={() => copy(entry.data.password, 'Password copied')}><Icon name="key" /></button>
                    )}
                    {entry.data.totp && (
                      <button className="btn icon" title="Copy 2FA code" onClick={() => copyTotp(entry)}><Icon name="shield" /></button>
                    )}
                    {writable && (
                      <button className="btn icon" title="Edit" onClick={() => onEdit(entry)}><Icon name="pen" /></button>
                    )}
                  </div>
                </div>
                {mons.length > 0 && (
                  <div className="credit-box">
                    {mons.map((mon) => (
                      <div key={mon.id} className={`credit-metric${monitorIsLow(mon) ? ' low' : ''}`}>
                        <div className="credit-info">
                          <div className="credit-label">
                            {mon.name || 'Credits'}{mon.kind === 'api' ? ' - live' : ''}
                          </div>
                          <div className="credit-value">{formatMonitorValue(mon)}</div>
                        </div>
                        <div className="credit-meta">
                          {timeAgo(mon.last_checked_at)}{monitorIsLow(mon) ? ' - LOW' : ''}
                        </div>
                        <button className="btn icon" title="Refresh now" onClick={() => onRefreshMonitor(mon)}>
                          <Icon name="refresh" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
