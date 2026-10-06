'use client';

import { Fragment, useState, useEffect } from 'react';
import { SELECTABLE_MODULES, SELECTABLE_KEYS, ROLE_DEFAULT_MODULES, effectiveModules } from '@/lib/modules';

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];

function roleBadgeClass(role: string) {
  if (role === 'admin') return 'bg-purple-100 text-purple-700';
  if (role === 'manager') return 'bg-blue-100 text-blue-700';
  if (role === 'warehouse') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

function roleDefaultKeys(role: string): string[] {
  return ROLE_DEFAULT_MODULES[role] ?? SELECTABLE_KEYS;
}

function accessSummary(u: any): string {
  if (u.role === 'admin') return 'All modules (admin)';
  const eff = effectiveModules(u);
  const isDefault = u.permissions == null;
  if (eff === 'all') return isDefault ? 'All modules' : 'All modules (custom)';
  const label = `${eff.length} of ${SELECTABLE_KEYS.length} modules`;
  return isDefault ? `${label} (role default)` : label;
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteErr, setInviteErr] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  // Module access editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [draftIsDefault, setDraftIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accessErr, setAccessErr] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [meRes, usersRes, invitesRes] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/auth/users'),
      fetch('/api/auth/invite'),
    ]);
    const me = await meRes.json();
    const usersData = await usersRes.json();
    const invitesData = await invitesRes.json();

    if (me.user) setCurrentUser(me.user);
    setUsers(usersData.users || []);
    setInvites(invitesData.invites || []);
    setLoading(false);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteMsg('');
    setInviteErr('');
    setInviteLink('');
    setInviting(true);

    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInviteMsg(`Invite sent to ${inviteEmail}`);
        setInviteLink(data.invite_link);
        setInviteEmail('');
        loadData();
      } else {
        setInviteErr(data.error || 'Failed to create invite');
      }
    } catch {
      setInviteErr('Network error');
    } finally {
      setInviting(false);
    }
  }

  async function toggleUserActive(userId: string, currentlyActive: boolean) {
    await fetch('/api/auth/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, is_active: !currentlyActive }),
    });
    loadData();
  }

  async function changeRole(u: any, newRole: string) {
    if (u.permissions != null && !window.confirm(
      `${u.full_name || u.email} has custom module access. Changing their role resets it to the ${newRole} default. Continue?`
    )) return;
    await fetch('/api/auth/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.id, role: newRole }),
    });
    if (editingId === u.id) setEditingId(null);
    loadData();
  }

  function openEditor(u: any) {
    if (editingId === u.id) { setEditingId(null); return; }
    const eff = effectiveModules(u);
    setDraft(eff === 'all' ? [...SELECTABLE_KEYS] : [...eff]);
    setDraftIsDefault(u.permissions == null);
    setAccessErr('');
    setEditingId(u.id);
  }

  function toggleDraft(key: string) {
    setDraftIsDefault(false);
    setDraft(d => (d.includes(key) ? d.filter(k => k !== key) : [...d, key]));
  }

  async function saveAccess(u: any) {
    setSaving(true);
    setAccessErr('');
    try {
      const res = await fetch('/api/auth/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: u.id, permissions: draftIsDefault ? null : draft }),
      });
      const data = await res.json();
      if (!res.ok) { setAccessErr(data.error || 'Could not save access'); return; }
      setEditingId(null);
      loadData();
    } catch {
      setAccessErr('Network error');
    } finally {
      setSaving(false);
    }
  }

  const isAdmin = currentUser?.role === 'admin';

  if (loading) return <div className="text-gray-400">Loading...</div>;

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-gray-500">Only admins can manage users and invites.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Invite User */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Invite New User</h2>

        {inviteMsg && (
          <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">
            {inviteMsg}
            {inviteLink && (
              <div className="mt-2">
                <p className="text-xs text-green-600 mb-1">Share this link with them:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inviteLink}
                    readOnly
                    className="flex-1 px-2 py-1 bg-white border border-green-300 rounded text-xs font-mono"
                    onClick={e => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => { navigator.clipboard.writeText(inviteLink); }}
                    className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {inviteErr && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{inviteErr}</div>
        )}

        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            placeholder="email@company.com"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {inviting ? 'Sending...' : 'Send Invite'}
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">New users start with their role's default modules. Adjust access below once they sign up.</p>
      </div>

      {/* Active Users */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Team Members ({users.length})</h2>
        <p className="text-xs text-gray-400 mb-4">Access changes apply within 5 minutes, no sign out needed.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-500">User</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Role</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Module access</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Last Login</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isSelf = u.id === currentUser.id;
                const editable = !isSelf && u.role !== 'admin';
                const open = editingId === u.id;
                return (
                  <Fragment key={u.id}>
                    <tr className={`border-b border-gray-100 ${open ? 'bg-gray-50' : ''}`}>
                      <td className="py-3 px-3">
                        <p className="font-medium text-gray-900">{u.full_name || 'No name'}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </td>
                      <td className="py-3 px-3">
                        {isSelf ? (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(u.role)}`}>{u.role}</span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={e => changeRole(u, e.target.value)}
                            className="px-2 py-1 border border-gray-200 rounded text-xs bg-white"
                          >
                            {ROLE_OPTIONS.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {editable ? (
                          <button
                            onClick={() => openEditor(u)}
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                          >
                            {accessSummary(u)} {open ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">{accessSummary(u)}</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                        }`}>{u.is_active ? 'Active' : 'Disabled'}</span>
                      </td>
                      <td className="py-3 px-3 text-gray-500 text-xs">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {!isSelf && (
                          <button
                            onClick={() => toggleUserActive(u.id, u.is_active)}
                            className={`text-xs px-2 py-1 rounded ${
                              u.is_active
                                ? 'text-red-600 hover:bg-red-50'
                                : 'text-green-600 hover:bg-green-50'
                            }`}
                          >
                            {u.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {open && (
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <td colSpan={6} className="px-3 pb-4 pt-1">
                          <div className="flex flex-wrap items-center gap-3 mb-3">
                            <span className="text-xs text-gray-500">
                              {draft.length} of {SELECTABLE_KEYS.length} selected
                              {draftIsDefault && ' (role default)'}
                            </span>
                            <button onClick={() => { setDraftIsDefault(false); setDraft([...SELECTABLE_KEYS]); }} className="text-xs text-gray-600 hover:text-brand-600">Select all</button>
                            <button onClick={() => { setDraftIsDefault(false); setDraft([]); }} className="text-xs text-gray-600 hover:text-brand-600">Clear</button>
                            <button onClick={() => { setDraftIsDefault(true); setDraft([...roleDefaultKeys(u.role)]); }} className="text-xs text-gray-600 hover:text-brand-600">Use {u.role} default</button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                            {SELECTABLE_MODULES.map(m => (
                              <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={draft.includes(m.key)}
                                  onChange={() => toggleDraft(m.key)}
                                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                                />
                                {m.label}
                              </label>
                            ))}
                          </div>

                          {draft.length === 0 && (
                            <p className="text-xs text-amber-600 mt-3">With nothing selected, this user can only open My Account.</p>
                          )}
                          {accessErr && <p className="text-xs text-red-600 mt-3">{accessErr}</p>}

                          <div className="flex gap-2 mt-4">
                            <button
                              onClick={() => saveAccess(u)}
                              disabled={saving}
                              className="px-4 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
                            >
                              {saving ? 'Saving...' : 'Save access'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-4 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600 hover:bg-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invites */}
      {invites.filter(i => !i.accepted_at).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Pending Invites ({invites.filter(i => !i.accepted_at).length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Email</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Role</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Sent</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Expires</th>
              </tr>
            </thead>
            <tbody>
              {invites.filter(i => !i.accepted_at).map(inv => {
                const expired = new Date(inv.expires_at) < new Date();
                return (
                  <tr key={inv.id} className="border-b border-gray-100">
                    <td className="py-3 px-3 font-medium text-gray-900">{inv.email}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(inv.role)}`}>{inv.role}</span>
                    </td>
                    <td className="py-3 px-3 text-gray-500 text-xs">
                      {new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-xs ${expired ? 'text-red-500' : 'text-gray-500'}`}>
                        {expired ? 'Expired' : new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
