'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import * as keychain from '@/lib/keychain';
import {
  decryptJson,
  encryptJson,
  exportKeyB64,
  generateVaultKey,
  importKeyB64,
  importPrivateKey,
  unwrapVaultKey,
  wrapVaultKey,
} from '@/lib/crypto';
import { pluck } from '@/components/ui';
import Auth from '@/components/Auth';
import Vault from '@/components/Vault';
import Editor from '@/components/Editor';
import Admin from '@/components/Admin';
import Settings from '@/components/Settings';

export default function App() {
  const [screen, setScreen] = useState('boot'); // boot|config|login|pending|master-setup|unlock|main|edit|settings|admin
  const [profile, setProfile] = useState(null);
  const [keyRecord, setKeyRecord] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [items, setItems] = useState([]);
  const [monitors, setMonitors] = useState([]);
  const [settings, setSettings] = useState(keychain.DEFAULT_SETTINGS);
  const [editingEntry, setEditingEntry] = useState(null); // null = closed, {id:null} = new
  const [toast, setToast] = useState(null);
  const vaultKeysRef = useRef(new Map());
  const toastTimer = useRef(null);
  const uidRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const applyTheme = useCallback((theme) => {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }, []);

  // ---------- boot ----------

  const boot = useCallback(async () => {
    const s = keychain.getSettings();
    setSettings(s);
    applyTheme(s.theme);

    api.adoptSessionFromUrlHash(); // email confirmation / recovery links

    const session = await api.getSession();
    if (!session) return setScreen('login');
    uidRef.current = session.user.id;

    let prof;
    try {
      [prof] = await api.rest(`/profiles?id=eq.${session.user.id}&select=*`);
    } catch (err) {
      setScreen('login');
      showToast(`Could not reach the server: ${err.message}`);
      return;
    }
    if (!prof || prof.status === 'pending' || prof.status === 'disabled') {
      setProfile(prof || null);
      return setScreen('pending');
    }
    setProfile(prof);
    applyTheme(prof.theme || 'light');
    keychain.saveSettings({ ...keychain.getSettings(), theme: prof.theme || 'light' });

    const [record] = await api.rest(`/user_keys?user_id=eq.${session.user.id}&select=*`);
    setKeyRecord(record || null);
    if (!record || !prof.public_key) return setScreen('master-setup');

    if (!keychain.getUnlocked()) return setScreen('unlock');
    await enterMain(prof);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  // Activity tracking + idle auto-lock
  useEffect(() => {
    const touch = () => keychain.touchActivity();
    document.addEventListener('click', touch, true);
    document.addEventListener('keydown', touch, true);
    const iv = setInterval(() => {
      if (keychain.activityExpired() && keychain.getUnlocked() === null) {
        vaultKeysRef.current = new Map();
        setScreen((cur) =>
          ['main', 'edit', 'settings', 'admin'].includes(cur) ? 'unlock' : cur
        );
      }
    }, 30000);
    return () => {
      document.removeEventListener('click', touch, true);
      document.removeEventListener('keydown', touch, true);
      clearInterval(iv);
    };
  }, []);

  // ---------- vault loading ----------

  async function refreshMemberships() {
    const rows = await api.rest(
      `/vault_members?user_id=eq.${uidRef.current}&select=vault_id,role,wrapped_key,vaults(id,name,type)`
    );
    setMemberships(rows);
    return rows;
  }

  async function ensurePersonalVault(prof, mems) {
    if (mems.some((m) => m.vaults?.type === 'personal')) return mems;
    const vaultKey = await generateVaultKey();
    const wrapped = await wrapVaultKey(prof.public_key, vaultKey);
    const [v] = await api.rest('/vaults?select=id', {
      method: 'POST',
      body: { name: 'Personal', type: 'personal' },
      prefer: 'return=representation',
    });
    await api.rest('/vault_members', {
      method: 'POST',
      body: { vault_id: v.id, user_id: uidRef.current, role: 'manager', wrapped_key: wrapped },
    });
    return refreshMemberships();
  }

  async function ensureVaultKeys(mems) {
    const unlocked = keychain.getUnlocked();
    if (!unlocked) return false;
    const priv = await importPrivateKey(unlocked.privateJwk);
    const map = new Map();
    let changed = false;
    for (const m of mems) {
      const cached = unlocked.vaultKeys[m.vault_id];
      if (cached) {
        map.set(m.vault_id, await importKeyB64(cached));
      } else {
        try {
          const key = await unwrapVaultKey(priv, m.wrapped_key);
          unlocked.vaultKeys[m.vault_id] = await exportKeyB64(key);
          map.set(m.vault_id, key);
          changed = true;
        } catch {
          /* wrapped for an older keypair */
        }
      }
    }
    if (changed) keychain.saveUnlocked(unlocked);
    vaultKeysRef.current = map;
    return true;
  }

  async function fetchItems(map) {
    const rows = await api.rest('/items?select=id,vault_id,created_by,iv,enc_data&order=updated_at.desc');
    const out = [];
    for (const row of rows) {
      const key = map.get(row.vault_id);
      if (!key) continue;
      try {
        out.push({
          id: row.id,
          vault_id: row.vault_id,
          created_by: row.created_by,
          data: await decryptJson(key, row.iv, row.enc_data),
        });
      } catch {
        /* skip undecryptable */
      }
    }
    setItems(out);
    return out;
  }

  async function fetchMonitors() {
    try {
      const rows = await api.rest('/tool_monitors?select=*&order=name');
      setMonitors(rows);
      return rows;
    } catch {
      setMonitors([]);
      return [];
    }
  }

  async function enterMain(prof = profile) {
    keychain.touchActivity();
    let mems = await refreshMemberships();
    try {
      mems = await ensurePersonalVault(prof, mems);
    } catch {
      /* retried next load */
    }
    const ok = await ensureVaultKeys(mems);
    if (!ok) return setScreen('unlock');
    const map = vaultKeysRef.current;
    await fetchItems(map);
    await fetchMonitors();
    setScreen('main');
  }

  // ---------- auth handlers ----------

  async function handleMasterSetup(masterPassword) {
    const { publicJwk, privateJwk, keyRecord: record } = await keychain.createUserKeys(masterPassword);
    await api.rest(`/profiles?id=eq.${uidRef.current}`, { method: 'PATCH', body: { public_key: publicJwk } });
    await api.rest('/user_keys', { method: 'POST', body: { user_id: uidRef.current, ...record } });
    const prof = { ...profile, public_key: publicJwk };
    setProfile(prof);
    setKeyRecord(record);
    keychain.setUnlocked(privateJwk);
    api.logEvent('keys.setup');
    await enterMain(prof);
    showToast('Vault ready');
  }

  async function handleUnlock(masterPassword) {
    const privateJwk = await keychain.decryptPrivateKey(masterPassword, keyRecord);
    keychain.setUnlocked(privateJwk);
    await enterMain();
  }

  async function handleSignOut() {
    keychain.lock();
    await api.signOut();
    vaultKeysRef.current = new Map();
    setProfile(null);
    setItems([]);
    setMonitors([]);
    setScreen('login');
  }

  function handleLock() {
    keychain.lock();
    vaultKeysRef.current = new Map();
    setScreen('unlock');
  }

  async function setTheme(theme) {
    applyTheme(theme);
    const next = { ...settings, theme };
    setSettings(next);
    keychain.saveSettings(next);
    if (profile) {
      setProfile({ ...profile, theme });
      api.rest(`/profiles?id=eq.${uidRef.current}`, { method: 'PATCH', body: { theme } }).catch(() => {});
    }
  }

  // ---------- monitors ----------

  async function fetchApiValue(cfg) {
    let res;
    try {
      res = await fetch(cfg.apiUrl, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' },
      });
    } catch {
      throw new Error("The tool's API blocked the browser (CORS) - refresh this metric from the extension instead.");
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`API answered ${res.status}: ${text.slice(0, 140)}`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`API did not return JSON: ${text.slice(0, 140)}`);
    }
    const v = pluck(json, (cfg.jsonPath || '').trim());
    if (v === undefined || v === null) {
      throw new Error(`Field "${cfg.jsonPath}" not found. Response starts: ${JSON.stringify(json).slice(0, 180)}`);
    }
    const numeric = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    if (Number.isNaN(numeric)) {
      throw new Error(`Field "${cfg.jsonPath}" contains "${String(v).slice(0, 60)}" - not a number.`);
    }
    return { value: v, numeric };
  }

  async function decryptApiConfig(mon) {
    if (mon.kind !== 'api' || !mon.api_enc || !mon.api_vault_id) return null;
    const key = vaultKeysRef.current.get(mon.api_vault_id);
    if (!key) return null;
    try {
      return await decryptJson(key, mon.api_iv, mon.api_enc);
    } catch {
      return null;
    }
  }

  async function refreshMonitor(mon) {
    if (mon.kind !== 'api') {
      showToast('Page-read metrics refresh from the extension while on the dashboard.');
      return;
    }
    const cfg = await decryptApiConfig(mon);
    if (!cfg) return showToast("You aren't in the vault holding this monitor's API key");
    try {
      const r = await fetchApiValue(cfg);
      const patch = {
        last_value: String(r.value),
        last_numeric: r.numeric,
        last_checked_at: new Date().toISOString(),
        last_checked_by: uidRef.current,
      };
      await api.rest(`/tool_monitors?id=eq.${mon.id}`, { method: 'PATCH', body: patch });
      setMonitors((cur) => cur.map((m) => (m.id === mon.id ? { ...m, ...patch } : m)));
      showToast(`${mon.name}: ${r.numeric.toLocaleString()}${mon.unit ? ` ${mon.unit}` : ''}`);
    } catch (err) {
      showToast(err.message);
    }
  }

  // ---------- entry save / delete (port of the extension's flow) ----------

  // bundle: { entryId, vaultId, data, metrics } - metrics are raw sub-form
  // objects; returns an error string or null on success.
  async function saveEntry(bundle) {
    const { entryId, vaultId, data, metrics } = bundle;
    const key = vaultKeysRef.current.get(vaultId);
    if (!key) return 'Vault key unavailable - lock and unlock again.';

    // validate + encrypt metric configs first
    const metricBodies = [];
    for (const m of metrics) {
      if (m.locked) continue;
      const label = (m.label || '').trim() || 'Credits';
      const thr = String(m.threshold ?? '').trim();
      const body = {
        name: label,
        kind: m.kind,
        unit: (m.unit || '').trim() || null,
        threshold: thr === '' ? null : Number(thr),
      };
      if (m.kind === 'page') {
        const murl = (m.url || '').trim() || data.url;
        if (!murl) return `"${label}": the dashboard URL is required.`;
        if (!m.selector && !(m.keyword || '').trim()) {
          return `"${label}": give a keyword to find the number by (element picking needs the extension).`;
        }
        Object.assign(body, {
          url: murl,
          selector: m.selector || null,
          keyword: (m.keyword || '').trim() || null,
          api_vault_id: null,
          api_iv: null,
          api_enc: null,
        });
      } else {
        const cfg = {
          apiUrl: (m.apiUrl || '').trim(),
          apiKey: (m.apiKey || '').trim(),
          jsonPath: (m.apiPath || '').trim(),
        };
        if (!/^https:\/\//.test(cfg.apiUrl)) return `"${label}": enter the full https:// API URL.`;
        if (!cfg.apiKey) return `"${label}": paste the API key.`;
        const kv = vaultKeysRef.current.get(m.apiVaultId);
        if (!kv) return `"${label}": pick a vault for the key.`;
        const enc = await encryptJson(kv, cfg);
        Object.assign(body, {
          url: new URL(cfg.apiUrl).origin,
          selector: null,
          keyword: null,
          api_vault_id: m.apiVaultId,
          api_iv: enc.iv,
          api_enc: enc.ct,
        });
      }
      metricBodies.push({ id: m.id, body });
    }

    const { iv, ct } = await encryptJson(key, data);
    let itemId = entryId;
    if (entryId) {
      await api.rest(`/items?id=eq.${entryId}`, {
        method: 'PATCH',
        body: { vault_id: vaultId, iv, enc_data: ct },
      });
      setItems((cur) => cur.map((e) => (e.id === entryId ? { ...e, vault_id: vaultId, data } : e)));
      api.logEvent('item.update', { item_id: entryId, vault_id: vaultId });
    } else {
      const [row] = await api.rest('/items?select=id', {
        method: 'POST',
        body: { vault_id: vaultId, iv, enc_data: ct },
        prefer: 'return=representation',
      });
      itemId = row.id;
      setItems((cur) => [...cur, { id: row.id, vault_id: vaultId, created_by: uidRef.current, data }]);
      api.logEvent('item.create', { item_id: itemId, vault_id: vaultId });
    }

    try {
      const keepIds = new Set(metrics.filter((m) => m.id).map((m) => m.id));
      for (const em of monitors.filter((m) => m.item_id === itemId)) {
        if (!keepIds.has(em.id)) {
          await api.rest(`/tool_monitors?id=eq.${em.id}`, { method: 'DELETE' });
        }
      }
      for (const { id: monId, body } of metricBodies) {
        body.item_id = itemId;
        if (monId) {
          await api.rest(`/tool_monitors?id=eq.${monId}`, { method: 'PATCH', body });
        } else {
          await api.rest('/tool_monitors', { method: 'POST', body });
        }
      }
      await fetchMonitors();
    } catch (err) {
      showToast(`Entry saved, but monitors failed: ${err.message}`);
    }
    return null;
  }

  async function deleteEntry(entryId) {
    await api.rest(`/items?id=eq.${entryId}`, { method: 'DELETE' });
    api.logEvent('item.delete', { item_id: entryId });
    setItems((cur) => cur.filter((e) => e.id !== entryId));
    await fetchMonitors();
  }

  async function changeMasterPassword(oldPw, newPw) {
    const privateJwk = await keychain.decryptPrivateKey(oldPw, keyRecord);
    const newRecord = await keychain.reencryptPrivateKey(privateJwk, newPw);
    await api.rest(`/user_keys?user_id=eq.${uidRef.current}`, { method: 'PATCH', body: newRecord });
    setKeyRecord(newRecord);
    api.logEvent('keys.master_password_changed');
  }

  // ---------- render ----------

  const shared = {
    profile,
    settings,
    setTheme,
    showToast,
    uid: uidRef.current,
    vaultKeysRef,
    memberships,
  };

  return (
    <>
      {screen === 'boot' && <div className="screen" />}
      {['login', 'pending', 'master-setup', 'unlock'].includes(screen) && (
        <Auth
          screen={screen}
          profile={profile}
          onBoot={boot}
          onSignOut={handleSignOut}
          onMasterSetup={handleMasterSetup}
          onUnlock={handleUnlock}
          showToast={showToast}
        />
      )}
      {screen === 'main' && (
        <Vault
          {...shared}
          items={items}
          monitors={monitors}
          onAdd={() => {
            setEditingEntry({ id: null });
            setScreen('edit');
          }}
          onEdit={(entry) => {
            setEditingEntry(entry);
            setScreen('edit');
          }}
          onRefreshMonitor={refreshMonitor}
          onSettings={() => setScreen('settings')}
          onAdmin={() => setScreen('admin')}
          onLock={handleLock}
        />
      )}
      {screen === 'edit' && (
        <Editor
          {...shared}
          items={items}
          entry={editingEntry?.id ? items.find((e) => e.id === editingEntry.id) : null}
          entryMonitors={editingEntry?.id ? monitors.filter((m) => m.item_id === editingEntry.id) : []}
          decryptApiConfig={decryptApiConfig}
          fetchApiValue={fetchApiValue}
          onSave={saveEntry}
          onDelete={deleteEntry}
          onBack={() => setScreen('main')}
        />
      )}
      {screen === 'settings' && (
        <Settings
          {...shared}
          setSettings={(s) => {
            setSettings(s);
            keychain.saveSettings(s);
          }}
          onChangeMaster={changeMasterPassword}
          onSignOut={handleSignOut}
          onBack={() => setScreen('main')}
        />
      )}
      {screen === 'admin' && (
        <Admin
          {...shared}
          refreshVaults={async () => {
            const mems = await refreshMemberships();
            await ensureVaultKeys(mems);
          }}
          onBack={() => setScreen('main')}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
