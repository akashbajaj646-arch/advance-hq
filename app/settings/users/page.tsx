'use client';

import { useState, useEffect } from 'react';
import { SELECTABLE_MODULES } from '@/lib/modules';

function ModuleCheckboxGrid({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
      {SELECTABLE_MODULES.map(m => (
        <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(m.key)}
            onChange={() => onToggle(m.key)}
            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          {m.label}
        </label>
      ))}
    </div>
  );
}

function permissionsSummary(u: any): string {
  if (u.role === 'admin' || u.permissions == null) return 'All modules';
  const n = Array.isArray(u.permissions) ? u.permissions.length : 0;
  return `${n} module${n === 1 ? '' : 's'}`;
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteAllModules, setInviteAllModules] = useState(true);
  const [inviteModules, setInviteModules] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteErr, setInviteErr] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  // Per-user module editor
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editAllModules, setEditAllModules] = useState(true);
  const [editModules, setEditModules] = useState<Set<string>>(new Set());
  const [savingPerms, setSavingPerms] = useState(false);

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

  function toggleInviteModule(key: string) {
    setInviteModules(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteMsg('');
    setInviteErr('');
    setInviteLink('');

    const permissions = inviteRole === 'admin' || inviteAllModules ? null : Array.from(inviteModules);
    if (permissions !== null && permissions.length === 0) {
      setInviteErr('Select at least one module, or check "All modules".');
      return;
    }

    setInviting(true);
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole, permissions }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInviteMsg(`Invite sent to ${inviteEmail}`);
        setInviteLink(data.invite_link);
        setInviteEmail('');
        setInviteAllModules(true);
        setInviteModules(new Set());
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

  async function changeRole(userId: string, newRole: string) {
    await fetch('/api/auth/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: newRole }),
    });
    loadData();
  }

  function openPermsEditor(u: any) {
    setEditingUserId(u.id);
    if (u.permissions == null) {
      setEditAllModules(true);
      setEditModules(new Set());
    } else {
      setEditAllModules(false);
      setEditModules(new Set(u.permissions));
    }
  }

  function toggleEditModule(key: string) {
    setEditModules(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function savePermissions(userId: string) {
    const permissions = editAllModules ? null : Array.from(editModules);
    if (permissions !== null && permissions.length === 0) {
      alert('Select at least one module, or check "All modules".');
      return;
    }
    setSavingPerms(true);
    await fetch('/api/auth/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, permissions }),
    });
    setSavingPerms(false);
    setEditingUserId(null);
    loadData();
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
                    className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {inviteErr && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">{inviteErr}</div>
        )}

        <form onSubmit={handleInvite} className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm"
                placeholder="colleague@company.com"
                required
              />
            </div>
            <div className="w-36">
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-sm bg-white"
              >
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
          </div>

          {/* Module access (hidden for admin invites — admins always get everything) */}
          {inviteRole !== 'admin' && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Module Access</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inviteAllModules}
                    onChange={e => setInviteAllModules(e.target.checked)}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  All modules
                </label>
              </div>
              {inviteAllModules ? (
                <p className="text-xs text-gray-500">This user will have access to every module. Uncheck "All modules" to pick specific ones.</p>
              ) : (
                <ModuleCheckboxGrid selected={inviteModules} onToggle={toggleInviteModule} />
              )}
              <p className="text-xs text-gray-400 mt-3">Dashboard and account settings are always available to every user.</p>
            </div>
          )}
        </form>
      </div>

      {/* Active Users */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Members ({users.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-gray-500">User</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Role</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Modules</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Last Login</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <>
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="py-3 px-3">
                    <p className="font-medium text-gray-900">{u.full_name || 'No name'}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="py-3 px-3">
                    {u.id === currentUser.id ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                        u.role === 'manager' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{u.role}</span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={e => changeRole(u.id, e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded text-xs bg-white"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">{permissionsSummary(u)}</span>
                      {u.role !== 'admin' && (
                        <button
                          onClick={() => (editingUserId === u.id ? setEditingUserId(null) : openPermsEditor(u))}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          {editingUserId === u.id ? 'Close' : 'Edit'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                    }`}>{u.is_active ? 'Active' : 'Disabled'}</span>
                  </td>
                  <td className="py-3 px-3 text-gray-500 text-xs">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="py-3 px-3 text-right">
                    {u.id !== currentUser.id && (
                      <button
                        onClick={() => toggleUserActive(u.id, u.is_active)}
                        className={`text-xs font-medium ${
                          u.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-700'
                        }`}
                      >
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
                {editingUserId === u.id && (
                  <tr key={`${u.id}-perms`} className="border-b border-gray-100 bg-gray-50">
                    <td colSpan={6} className="py-4 px-6">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-gray-700">Module access for {u.full_name || u.email}</p>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editAllModules}
                            onChange={e => setEditAllModules(e.target.checked)}
                            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          />
                          All modules
                        </label>
                      </div>
                      {!editAllModules && (
                        <ModuleCheckboxGrid selected={editModules} onToggle={toggleEditModule} />
                      )}
                      <div className="flex items-center gap-3 mt-4">
                        <button
                          onClick={() => savePermissions(u.id)}
                          disabled={savingPerms}
                          className="bg-brand-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-700 disabled:opacity-50"
                        >
                          {savingPerms ? 'Saving...' : 'Save Access'}
                        </button>
                        <button
                          onClick={() => setEditingUserId(null)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                        <p className="text-xs text-gray-400 ml-auto">Changes apply on their next page load.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending Invites */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Invites</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-gray-400">No invites yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-medium text-gray-500">Email</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Role</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Modules</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
                <th className="text-right py-2 px-3 font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map(inv => {
                const accepted = !!inv.accepted_at;
                const expired = !accepted && new Date(inv.expires_at) < new Date();
                const pending = !accepted && !expired;
                return (
                  <tr key={inv.id} className="border-b border-gray-100">
                    <td className="py-3 px-3 text-gray-900">{inv.email}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{inv.role}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{permissionsSummary(inv)}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        accepted ? 'bg-green-100 text-green-700' :
                        expired ? 'bg-gray-100 text-gray-500' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {accepted ? 'Accepted' : expired ? 'Expired' : 'Pending'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {pending && (
                        <button
                          onClick={() => {
                            const link = `${window.location.origin}/signup?token=${inv.token}`;
                            navigator.clipboard.writeText(link);
                          }}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          Copy Link
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
