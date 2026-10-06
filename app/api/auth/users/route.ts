import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';
import { isValidModuleKey, SELECTABLE_KEYS } from '@/lib/modules';

const VALID_ROLES = new Set(['viewer', 'warehouse', 'manager', 'admin']);

// GET: list all users (admin only)
export async function GET() {
  try {
    const result = await getSession();
    if (!result || result.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: users } = await supabaseAdmin
      .from('hq_users')
      .select('id, email, full_name, role, permissions, is_active, last_login_at, created_at')
      .order('created_at', { ascending: true });

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH: update user role/permissions/active status
//   permissions: null = role default, string[] = explicit allowlist of module keys
//   Changing role without sending permissions resets the user to the new role's default.
export async function PATCH(request: Request) {
  try {
    const result = await getSession();
    if (!result || result.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { user_id, role, permissions, is_active } = await request.json();
    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const isSelf = user_id === result.user.id;

    // Prevent admin from deactivating or demoting themselves
    if (isSelf && is_active === false) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 });
    }
    if (isSelf && role !== undefined && role !== 'admin') {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    if (role !== undefined && !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    let cleanPermissions: string[] | null | undefined = undefined;
    if (permissions !== undefined) {
      if (permissions === null) {
        cleanPermissions = null;
      } else if (Array.isArray(permissions) && permissions.every(isValidModuleKey)) {
        // Dedupe and keep sidebar order
        cleanPermissions = SELECTABLE_KEYS.filter(k => permissions.includes(k));
      } else {
        return NextResponse.json({ error: 'Invalid permissions list' }, { status: 400 });
      }
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (role !== undefined) {
      updates.role = role;
      if (cleanPermissions === undefined) updates.permissions = null; // reset to new role's default
    }
    if (cleanPermissions !== undefined) updates.permissions = cleanPermissions;
    if (updates.role === 'admin') updates.permissions = null; // admins always get everything
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await supabaseAdmin
      .from('hq_users')
      .update(updates)
      .eq('id', user_id);

    if (error) {
      console.error('User update error:', error);
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
