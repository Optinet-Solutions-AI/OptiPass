'use client';

import { useEffect, useState } from 'react';
import { generatePassword, generateTotp } from '@/lib/crypto';
import { Icon } from '@/components/ui';

export default function Editor({
  entry,
  entryMonitors,
  memberships,
  items,
  uid,
  decryptApiConfig,
  fetchApiValue,
  showToast,
  onSave,
  onDelete,
  onBack,
}) {
  const writableVaults = memberships
    .filter((m) => ['manager', 'editor'].includes(m.role))
    .sort((a, b) => {
      if (a.vaults.type !== b.vaults.type) return a.vaults.type === 'personal' ? -1 : 1;
      return a.vaults.name.localeCompare(b.vaults.name);
    });

  const [vaultId, setVaultId] = useState(entry?.vault_id || writableVaults[0]?.vault_id || '');
  const [title, setTitle] = useState(entry?.data.title || '');
  const [url, setUrl] = useState(entry?.data.url || '');
  const [tags, setTags] = useState((entry?.data.tags || []).join(', '));
  const [signinMethod, setSigninMethod] = useState(
    (entry?.data.signinMethod || 'password') === 'password' ? 'password' : 'oauth'
  );
  const [ssoItemId, setSsoItemId] = useState(entry?.data.ssoItemId || '');
  const [username, setUsername] = useState(entry?.data.username || '');
  const [password, setPassword] = useState(entry?.data.password || '');
  const [reveal, setReveal] = useState(false);
  const [genLen, setGenLen] = useState(20);
  const [genSym, setGenSym] = useState(true);
  const [totp, setTotp] = useState(entry?.data.totp || '');
  const [totpPreview, setTotpPreview] = useState(null);
  const [secrets, setSecrets] = useState((entry?.data.secrets || []).map((s) => ({ ...s })));
  const [notes, setNotes] = useState(entry?.data.notes || '');
  const [metrics, setMetrics] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load metric sub-forms (decrypting API configs where we can)
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = [];
      for (const mon of entryMonitors) {
        const m = {
          id: mon.id,
          label: mon.name || '',
          kind: mon.kind || 'page',
          url: mon.kind === 'page' ? mon.url || '' : '',
          selector: mon.selector || '',
          keyword: mon.keyword || '',
          apiUrl: '',
          apiKey: '',
          apiPath: '',
          apiVaultId: mon.api_vault_id || vaultId,
          unit: mon.unit || '',
          threshold: mon.threshold ?? '',
          locked: false,
        };
        if (mon.kind === 'api') {
          const cfg = await decryptApiConfig(mon);
          if (cfg) {
            m.apiUrl = cfg.apiUrl || '';
            m.apiKey = cfg.apiKey || '';
            m.apiPath = cfg.jsonPath || '';
          } else {
            m.locked = true;
          }
        }
        out.push(m);
      }
      if (alive) setMetrics(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live TOTP preview
  useEffect(() => {
    let alive = true;
    async function tick() {
      const raw = totp.trim();
      if (!raw) return alive && setTotpPreview(null);
      const t = await generateTotp(raw);
      if (alive) setTotpPreview(t || { invalid: true });
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [totp]);

  function setMetric(i, patch) {
    setMetrics((cur) => cur.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  async function testMetric(i) {
    const m = metrics[i];
    try {
      const r = await fetchApiValue({
        apiUrl: (m.apiUrl || '').trim(),
        apiKey: (m.apiKey || '').trim(),
        jsonPath: (m.apiPath || '').trim(),
      });
      showToast(`Found: ${r.numeric.toLocaleString()} (raw: ${JSON.stringify(r.value)})`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function save() {
    setError(null);
    if (!title.trim()) return setError('Title is required.');
    if (!vaultId) return setError('Pick a vault.');
    const totpVal = totp.trim();
    if (totpVal && !(await generateTotp(totpVal))) {
      return setError("The 2FA key isn't valid - paste the site's setup key or its otpauth:// link.");
    }
    const now = new Date().toISOString();
    const ssoLinked = signinMethod !== 'password' && ssoItemId ? (items || []).find((e) => e.id === ssoItemId) : null;
    const data = {
      ...(entry?.data || {}), // preserve fields this form doesn't cover (top-ups, payment link...)
      type: 'login',
      title: title.trim(),
      url: url.trim(),
      tags: [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))],
      signinMethod,
      ssoItemId: signinMethod === 'password' ? null : ssoItemId || null,
      ssoEmail: ssoLinked ? ssoLinked.data.username || '' : '',
      username: username.trim(),
      password,
      totp: totpVal,
      secrets: secrets
        .map((s) => ({ label: (s.label || '').trim(), value: s.value || '' }))
        .filter((s) => s.label || s.value),
      notes: notes.trim(),
      createdAt: entry?.data.createdAt || now,
      updatedAt: now,
    };
    setBusy(true);
    try {
      const err = await onSave({ entryId: entry?.id || null, vaultId, data, metrics });
      if (err) return setError(err);
      showToast('Saved');
      onBack();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn icon" onClick={onBack}><Icon name="back" /></button>
        <h2>{entry ? 'Edit entry' : 'Add entry'}</h2>
      </header>

      <label>Who has access</label>
      <select
        value={vaultId}
        onChange={(e) => setVaultId(e.target.value)}
        disabled={!!entry && !!entry.created_by && entry.created_by !== uid}
        title={
          entry && entry.created_by && entry.created_by !== uid
            ? "Only the tool's creator can move it to another vault"
            : undefined
        }
      >
        {writableVaults.map((m) => (
          <option key={m.vault_id} value={m.vault_id}>
            {m.vaults.type === 'personal' ? 'Private (only me)' : `Team: ${m.vaults.name}`}
          </option>
        ))}
      </select>

      <label>Tool name</label>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. OpenAI" />
      <label>Tool link</label>
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://platform.openai.com" />
      <label>Tags (comma-separated)</label>
      <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. Project Phoenix, AI tools" autoComplete="off" />

      <label>Sign-in method</label>
      <select value={signinMethod} onChange={(e) => setSigninMethod(e.target.value)}>
        <option value="password">Username &amp; password</option>
        <option value="oauth">OAuth (Google, GitHub, ...)</option>
      </select>
      {signinMethod !== 'password' && (
        <>
          <label>Signs in with which account</label>
          <select value={ssoItemId} onChange={(e) => setSsoItemId(e.target.value)}>
            <option value="">(pick the account entry)</option>
            {(items || [])
              .filter((e) => e.id !== entry?.id)
              .sort((a, b) => (a.data.title || '').localeCompare(b.data.title || ''))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.data.title}{e.data.username ? ` - ${e.data.username}` : ''}
                </option>
              ))}
          </select>
        </>
      )}
      {signinMethod === 'password' && (
        <>
          <label>Username / email</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          <label>Password</label>
          <div className="row">
            <input type={reveal ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            <button className="btn icon" title="Show / hide" onClick={() => setReveal(!reveal)}><Icon name="eye" /></button>
            <button
              className="btn icon"
              title="Generate password"
              onClick={() => {
                setPassword(generatePassword(Math.min(64, Math.max(8, genLen)), { symbols: genSym }));
                setReveal(true);
              }}
            >
              <Icon name="zap" />
            </button>
          </div>
          <div className="row muted" style={{ fontSize: 12 }}>
            <span>Length</span>
            <input type="number" min="8" max="64" value={genLen} onChange={(e) => setGenLen(parseInt(e.target.value, 10) || 20)} />
            <label className="checkbox"><input type="checkbox" checked={genSym} onChange={(e) => setGenSym(e.target.checked)} /> Symbols</label>
          </div>
        </>
      )}

      <label>2FA one-time passwords (optional)</label>
      <input type="text" value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="Paste the site's 2FA setup key or otpauth:// link" autoComplete="off" />
      {totpPreview && (
        <div className="totp-preview">
          {totpPreview.invalid ? (
            <span className="totp-code invalid">This doesn&apos;t look like a valid 2FA key yet</span>
          ) : (
            <>
              <span className="totp-code">{totpPreview.code.slice(0, 3)} {totpPreview.code.slice(3)}</span>
              <span className="muted">renews in {totpPreview.secondsLeft}s</span>
            </>
          )}
        </div>
      )}

      <div className="monitor-head">
        <label>API keys &amp; secrets</label>
        <button className="btn small" onClick={() => setSecrets([...secrets, { label: '', value: '' }])}>+ Add secret</button>
      </div>
      <div className="stack">
        {secrets.map((s, i) => (
          <div className="row" style={{ margin: 0 }} key={i}>
            <input type="text" value={s.label} placeholder="Label, e.g. Private API key" onChange={(e) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input type="password" value={s.value} placeholder="Secret value" onChange={(e) => setSecrets(secrets.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button className="btn icon" title="Copy secret" onClick={async () => { await navigator.clipboard.writeText(s.value || ''); showToast('Secret copied'); }}><Icon name="key" /></button>
            <button className="btn icon" title="Remove" onClick={() => setSecrets(secrets.filter((_, j) => j !== i))}><Icon name="trash" /></button>
          </div>
        ))}
      </div>

      <div className="monitor-head">
        <label>Credit &amp; usage monitors</label>
        <button
          className="btn small"
          onClick={() =>
            setMetrics([
              ...metrics,
              {
                id: null,
                label: ['Credits', 'Bandwidth'][metrics.length] || '',
                kind: 'api',
                url: '',
                selector: '',
                keyword: '',
                apiUrl: '',
                apiKey: '',
                apiPath: '',
                apiVaultId: vaultId,
                unit: '',
                threshold: '',
                locked: false,
              },
            ])
          }
        >
          + Add metric
        </button>
      </div>
      <div className="stack">
        {metrics.map((m, i) =>
          m.locked ? (
            <div className="metric-block" key={m.id || i}>
              <p className="muted">&quot;{m.label || 'Metric'}&quot; uses an API key in a vault you&apos;re not in - only members of that vault can edit it.</p>
            </div>
          ) : (
            <div className="metric-block" key={m.id || i}>
              <div className="row" style={{ marginTop: 0 }}>
                <input type="text" value={m.label} placeholder="Metric name, e.g. Bandwidth" onChange={(e) => setMetric(i, { label: e.target.value })} />
                <select value={m.kind} onChange={(e) => setMetric(i, { kind: e.target.value })}>
                  <option value="page">Dashboard page</option>
                  <option value="api">Tool&apos;s API</option>
                </select>
                <button className="btn icon" title="Remove metric" onClick={() => setMetrics(metrics.filter((_, j) => j !== i))}><Icon name="trash" /></button>
              </div>
              {m.kind === 'page' ? (
                <>
                  <label>Dashboard page (where the number is shown)</label>
                  <input type="text" value={m.url} onChange={(e) => setMetric(i, { url: e.target.value })} placeholder="https://tool.example.com/dashboard" />
                  <label>Find the number by a nearby word</label>
                  <input type="text" value={m.keyword} onChange={(e) => setMetric(i, { keyword: e.target.value })} placeholder='e.g. "bandwidth"' />
                  <p className="muted" style={{ marginTop: 6 }}>Click-to-pick and page capture run in the Chrome extension; the web app shows the readings.</p>
                </>
              ) : (
                <>
                  <label>API endpoint that returns the number</label>
                  <input type="text" value={m.apiUrl} onChange={(e) => setMetric(i, { apiUrl: e.target.value })} placeholder="https://tool.example.com/api/balance" autoComplete="off" />
                  <label>API key (stored end-to-end encrypted)</label>
                  <input type="password" value={m.apiKey} onChange={(e) => setMetric(i, { apiKey: e.target.value })} autoComplete="off" />
                  <label>Response field that holds the number</label>
                  <input type="text" value={m.apiPath} onChange={(e) => setMetric(i, { apiPath: e.target.value })} placeholder="e.g. remainingBandwidth or 0.balance" autoComplete="off" />
                  <label>Keep the key in vault</label>
                  <select value={m.apiVaultId} onChange={(e) => setMetric(i, { apiVaultId: e.target.value })}>
                    {memberships.map((mem) => (
                      <option key={mem.vault_id} value={mem.vault_id}>{mem.vaults.name}</option>
                    ))}
                  </select>
                  <button className="btn full" onClick={() => testMetric(i)}>Test - fetch the value now</button>
                </>
              )}
              <div className="row">
                <div style={{ flex: 1 }}>
                  <label>Unit</label>
                  <input type="text" value={m.unit} onChange={(e) => setMetric(i, { unit: e.target.value })} placeholder="credits / GB / USD" />
                </div>
                <div>
                  <label>Warn below</label>
                  <input type="number" min="0" value={m.threshold} onChange={(e) => setMetric(i, { threshold: e.target.value })} />
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <label>Notes</label>
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary grow" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save'}</button>
        {entry && (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              await onDelete(entry.id);
              showToast('Entry deleted');
              onBack();
            }}
          >
            {confirmDelete ? 'Confirm delete' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
