'use client';

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { generateVaultKey, wrapVaultKey } from '@/lib/crypto';
import { Icon } from '@/components/ui';

export default function Admin({ profile, memberships, vaultKeysRef, refreshVaults, showToast, uid, onBack }) {
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState('member');
  const [newVault, setNewVault] = useState('');
  const [mvVault, setMvVault] = useState('');
  const [mvMembers, setMvMembers] = useState([]);
  const [mvUser, setMvUser] = useState('');
  const [mvRole, setMvRole] = useState('editor');
  const [confirmVaultDelete, setConfirmVaultDelete] = useState(false);
  const [deleteArm, setDeleteArm] = useState(null);

  const isSuper = profile?.role === 'super_admin';
  const managed = memberships.filter((m) => m.role === 'manager' && m.vaults.type === 'shared');

  async function loadUsers() {
    setUsers(await api.rest('/profiles?select=id,email,display_name,role,status,public_key&order=email'));
  }
  async function loadInvites() {
    setInvites(await api.rest('/invites?select=*&order=email'));
  }
  async function loadMembers(vaultId) {
    if (!vaultId) return setMvMembers([]);
    setMvMembers(
      await api.rest(`/vault_members?vault_id=eq.${vaultId}&select=user_id,role,profiles(email,display_name)`)
    );
  }

  useEffect(() => {
    loadUsers().catch((e) => showToast(e.message));
    loadInvites().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mvVault && managed[0]) setMvVault(managed[0].vault_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberships]);

  useEffect(() => {
    loadMembers(mvVault).catch(() => {});
    setConfirmVaultDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mvVault]);

  async function adminUpdate(targetId, newRole, newStatus) {
    try {
      await api.rpc('admin_update_user', { target_id: targetId, new_role: newRole, new_status: newStatus });
      api.logEvent('user.admin_update', { target_id: targetId, new_role: newRole, new_status: newStatus });
      await loadUsers();
      showToast('Updated');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function createInvite() {
    const email = invEmail.trim().toLowerCase();
    if (!email.includes('@')) return showToast('Enter a valid email');
    try {
      const [inv] = await api.rest('/invites?select=*', {
        method: 'POST',
        body: { email, role: invRole },
        prefer: 'return=representation',
      });
      api.logEvent('invite.create', { email });
      setInvEmail('');
      await loadInvites();
      if (inv?.code) {
        await navigator.clipboard.writeText(inv.code);
        showToast(`Invited ${email} - invite code copied`);
      } else {
        showToast(`Invited ${email}`);
      }
    } catch (err) {
      showToast(err.message);
    }
  }

  async function createVault() {
    const name = newVault.trim();
    if (!name) return showToast('Give the vault a name');
    try {
      const vaultKey = await generateVaultKey();
      const wrapped = await wrapVaultKey(profile.public_key, vaultKey);
      const [v] = await api.rest('/vaults?select=id', {
        method: 'POST',
        body: { name, type: 'shared' },
        prefer: 'return=representation',
      });
      await api.rest('/vault_members', {
        method: 'POST',
        body: { vault_id: v.id, user_id: uid, role: 'manager', wrapped_key: wrapped },
      });
      api.logEvent('vault.create', { vault_id: v.id, name });
      setNewVault('');
      await refreshVaults();
      showToast(`Vault "${name}" created`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function addMember() {
    if (!mvVault || !mvUser) return showToast('Pick a vault and a user');
    const vaultKey = vaultKeysRef.current.get(mvVault);
    if (!vaultKey) return showToast('Vault key unavailable - lock and unlock again');
    try {
      const target = users.find((p) => p.id === mvUser);
      const wrapped = await wrapVaultKey(target.public_key, vaultKey);
      await api.rest('/vault_members', {
        method: 'POST',
        body: { vault_id: mvVault, user_id: mvUser, role: mvRole, wrapped_key: wrapped },
      });
      api.logEvent('member.add', { vault_id: mvVault, user_id: mvUser, role: mvRole });
      await loadMembers(mvVault);
      showToast('Member added');
    } catch (err) {
      showToast(err.message);
    }
  }

  const memberIds = new Set(mvMembers.map((m) => m.user_id));
  const candidates = users.filter((p) => p.status === 'active' && p.public_key && !memberIds.has(p.id));

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn icon" onClick={onBack}><Icon name="back" /></button>
        <h2>Team administration</h2>
      </header>

      <section>
        <h3>Members</h3>
        <div className="stack">
          {users.map((p) => (
            <div className="person" key={p.id}>
              <div className="who">
                {(p.display_name || p.email) + (p.id === uid ? ' (you)' : '')}
                <small>{p.email} - {p.role.replace('_', ' ')} - {p.status}</small>
              </div>
              {p.role !== 'super_admin' && p.id !== uid && (
                <>
                  {p.status === 'pending' && (
                    <>
                      <button className="btn small" onClick={() => adminUpdate(p.id, null, 'active')}>Approve</button>
                      <button className="btn small" onClick={() => adminUpdate(p.id, null, 'disabled')}>Reject</button>
                    </>
                  )}
                  {p.status === 'active' && (
                    <>
                      <button className="btn small" onClick={() => adminUpdate(p.id, null, 'disabled')}>Disable</button>
                      {isSuper && (
                        <button className="btn small" onClick={() => adminUpdate(p.id, p.role === 'admin' ? 'member' : 'admin', null)}>
                          {p.role === 'admin' ? 'Make member' : 'Make admin'}
                        </button>
                      )}
                    </>
                  )}
                  {p.status === 'disabled' && (
                    <button className="btn small" onClick={() => adminUpdate(p.id, null, 'active')}>Enable</button>
                  )}
                  {isSuper && (
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        if (deleteArm !== p.id) return setDeleteArm(p.id);
                        try {
                          await api.rpc('admin_delete_user', { target_id: p.id });
                          api.logEvent('user.delete', { target_id: p.id });
                          setDeleteArm(null);
                          await loadUsers();
                          showToast('User deleted');
                        } catch (err) {
                          setDeleteArm(null);
                          showToast(err.message);
                        }
                      }}
                    >
                      {deleteArm === p.id ? 'Confirm delete' : 'Delete'}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Invite by email</h3>
        <p className="muted">Send the copied invite code to your teammate - they sign up with it and are active instantly.</p>
        <div className="row">
          <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@optinetsolutions.com" />
          <select value={invRole} onChange={(e) => setInvRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn" onClick={createInvite}>Invite</button>
        </div>
        <div className="stack">
          {invites.map((inv) => (
            <div className="person" key={inv.email}>
              <div className="who">{inv.email} ({inv.role})</div>
              {inv.code && (
                <button className="btn small" onClick={async () => { await navigator.clipboard.writeText(inv.code); showToast('Invite code copied'); }}>
                  Copy code
                </button>
              )}
              <button
                className="btn small"
                onClick={async () => {
                  await api.rest(`/invites?email=eq.${encodeURIComponent(inv.email)}`, { method: 'DELETE' });
                  loadInvites();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Shared vaults (teams)</h3>
        <div className="row">
          <input type="text" value={newVault} onChange={(e) => setNewVault(e.target.value)} placeholder="New vault name, e.g. AI Team" />
          <button className="btn" onClick={createVault}>Create</button>
        </div>
      </section>

      <section>
        <h3>Vault members</h3>
        <select value={mvVault} onChange={(e) => setMvVault(e.target.value)}>
          {managed.map((m) => (
            <option key={m.vault_id} value={m.vault_id}>{m.vaults.name}</option>
          ))}
        </select>
        <div className="stack">
          {mvMembers.map((mem) => (
            <div className="person" key={mem.user_id}>
              <div className="who">{mem.profiles?.display_name || mem.profiles?.email || mem.user_id} ({mem.role === 'manager' ? 'admin' : mem.role})</div>
              {mem.user_id !== uid && (
                <button
                  className="btn small"
                  onClick={async () => {
                    await api.rest(`/vault_members?vault_id=eq.${mvVault}&user_id=eq.${mem.user_id}`, { method: 'DELETE' });
                    api.logEvent('member.remove', { vault_id: mvVault, user_id: mem.user_id });
                    loadMembers(mvVault);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="row">
          <select value={mvUser} onChange={(e) => setMvUser(e.target.value)} style={{ flex: 1 }}>
            <option value="">Add member...</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
            ))}
          </select>
          <select value={mvRole} onChange={(e) => setMvRole(e.target.value)}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="manager">Admin</option>
          </select>
          <button className="btn" onClick={addMember}>Add</button>
        </div>
        {mvVault && (
          <button
            className="btn danger full"
            onClick={async () => {
              if (!confirmVaultDelete) return setConfirmVaultDelete(true);
              await api.rest(`/vaults?id=eq.${mvVault}`, { method: 'DELETE' });
              api.logEvent('vault.delete', { vault_id: mvVault });
              setMvVault('');
              await refreshVaults();
              showToast('Vault deleted');
            }}
          >
            {confirmVaultDelete ? 'Click again to delete vault + all its entries' : 'Delete this vault'}
          </button>
        )}
      </section>
    </div>
  );
}
