'use client';

import { useState, useEffect } from 'react';

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

  async function changeRole(userId: string, newRole: string) {
    await fetch('/api/auth/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role: newRole }),
    });
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

        <form onSubmit={handleInvite} className="flex items-end gap-3">
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
              <th className="text-left py-2 px-3 font-medium text-gray-500">Status</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">Last Login</th>
              <th className="text-right py-2 px-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
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
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>{u.is_active ? 'Active' : 'Disabled'}</span>
                </td>
                <td className="py-3 px-3 text-gray-500 text-xs">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                </td>
                <td className="py-3 px-3 text-right">
                  {u.id !== currentUser.id && (
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
            ))}
          </tbody>
        </table>
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
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{inv.role}</span>
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
