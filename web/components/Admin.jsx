'use client';

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { generateVaultKey, wrapVaultKey } from '@/lib/crypto';
import { Icon } from '@/components/ui';

function signupLink(inv) {
  return `${window.location.origin}/?invite=${encodeURIComponent(inv.code)}&email=${encodeURIComponent(inv.email)}`;
}

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
  // Removing an invite or a member takes two clicks; holds the armed button's key.
  const [removeArm, setRemoveArm] = useState(null);

  // A DELETE the permission rules block removes nothing without an error,
  // so ask for the removed rows back and report a block plainly.
  async function removeOrFail(path, what) {
    const rows = await api.rest(path, { method: 'DELETE', prefer: 'return=representation' });
    if (!rows || rows.length === 0) {
      throw new Error(`Couldn't remove ${what}: you may not have permission, or it was already removed.`);
    }
  }

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
        await navigator.clipboard.writeText(signupLink(inv));
        showToast(`Invited ${email} - signup link copied`);
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
    if (!mvVault) return showToast('Create or pick a team vault first');
    if (!mvUser) return showToast('Pick the person to add');
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

  // Who can be added, and why the others can't be yet: adding someone wraps
  // the vault key with their public key, which only exists once they have
  // signed up and set a master password.
  const memberIds = new Set(mvMembers.map((m) => m.user_id));
  const candidates = [];
  const waiting = [];
  for (const p of users) {
    if (memberIds.has(p.id)) continue;
    const name = p.display_name || p.email;
    if (p.status === 'disabled') waiting.push(`${name} - account disabled`);
    else if (p.status !== 'active') waiting.push(`${name} - waiting for approval`);
    else if (!p.public_key) waiting.push(`${name} - hasn't finished setup (no master password yet)`);
    else candidates.push(p);
  }
  const signedUp = new Set(users.map((p) => p.email));
  for (const inv of invites) {
    if (!signedUp.has(inv.email)) waiting.push(`${inv.email} - invited, hasn't signed up yet`);
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn icon" title="Back" aria-label="Back" onClick={onBack}><Icon name="back" /></button>
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
        <p className="muted">Invite copies a signup link to send them. They're active the moment they sign up. Sign-ups without an invite are rejected.</p>
        <div className="row">
          <input type="email" aria-label="Email to invite" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@optinetsolutions.com" />
          <select aria-label="Role for the invited person" value={invRole} onChange={(e) => setInvRole(e.target.value)}>
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
                <>
                  <button className="btn small" onClick={async () => { await navigator.clipboard.writeText(signupLink(inv)); showToast('Signup link copied'); }}>
                    Copy link
                  </button>
                  <button className="btn small" onClick={async () => { await navigator.clipboard.writeText(inv.code); showToast('Invite code copied'); }}>
                    Copy code
                  </button>
                </>
              )}
              <button
                className="btn small danger"
                onClick={async () => {
                  const armKey = `invite:${inv.email}`;
                  if (removeArm !== armKey) return setRemoveArm(armKey);
                  setRemoveArm(null);
                  try {
                    await removeOrFail(`/invites?email=eq.${encodeURIComponent(inv.email)}`, 'this invite');
                    api.logEvent('invite.delete', { email: inv.email });
                    await loadInvites();
                    showToast(`Invite for ${inv.email} removed - their signup link no longer works`);
                  } catch (err) {
                    showToast(err.message);
                  }
                }}
              >
                {removeArm === `invite:${inv.email}` ? 'Confirm remove' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3>Team vaults</h3>
        <div className="row">
          <input type="text" value={newVault} onChange={(e) => setNewVault(e.target.value)} placeholder="New team vault name, e.g. AI Team" aria-label="New team vault name" />
          <button className="btn" onClick={createVault}>Create</button>
        </div>
      </section>

      <section>
        <h3>Vault members</h3>
        <p className="muted">
          You can manage the team vaults where you are a Manager. <strong>Manager</strong>: add/remove members, delete
          the vault. <strong>Editor</strong>: add and edit tools. <strong>Viewer</strong>: see and copy only.
        </p>
        <select aria-label="Team vault" value={mvVault} onChange={(e) => setMvVault(e.target.value)}>
          {managed.map((m) => (
            <option key={m.vault_id} value={m.vault_id}>{m.vaults.name}</option>
          ))}
        </select>
        <div className="stack">
          {mvMembers.map((mem) => (
            <div className="person" key={mem.user_id}>
              <div className="who">{mem.profiles?.display_name || mem.profiles?.email || mem.user_id} ({{ manager: 'Manager', editor: 'Editor', viewer: 'Viewer' }[mem.role] || mem.role})</div>
              {mem.user_id !== uid && (
                <button
                  className="btn small danger"
                  onClick={async () => {
                    const armKey = `member:${mem.user_id}`;
                    if (removeArm !== armKey) return setRemoveArm(armKey);
                    setRemoveArm(null);
                    const name = mem.profiles?.display_name || mem.profiles?.email || 'this person';
                    const vault = memberships.find((m) => m.vault_id === mvVault)?.vaults?.name || 'the vault';
                    try {
                      await removeOrFail(`/vault_members?vault_id=eq.${mvVault}&user_id=eq.${mem.user_id}`, name);
                      api.logEvent('member.remove', { vault_id: mvVault, user_id: mem.user_id });
                      await loadMembers(mvVault);
                      showToast(`Removed ${name} from ${vault}. Change any passwords they could see.`);
                    } catch (err) {
                      showToast(err.message);
                    }
                  }}
                >
                  {removeArm === `member:${mem.user_id}` ? 'Confirm remove' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="row">
          <select aria-label="Person to add" value={mvUser} onChange={(e) => setMvUser(e.target.value)} style={{ flex: 1 }}>
            <option value="">{candidates.length ? 'Add a person...' : 'No one else can be added yet'}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
            ))}
            {waiting.length > 0 && (
              <optgroup label="Can't be added yet">
                {waiting.map((label) => (
                  <option key={label} value="" disabled>{label}</option>
                ))}
              </optgroup>
            )}
          </select>
          <select aria-label="Their role in this vault" value={mvRole} onChange={(e) => setMvRole(e.target.value)}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="manager">Manager</option>
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
            {confirmVaultDelete ? 'Click again to delete vault + all its tools' : 'Delete this vault'}
          </button>
        )}
      </section>
    </div>
  );
}
