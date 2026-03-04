import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

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

    // Prevent admin from deactivating themselves
    if (user_id === result.user.id && is_active === false) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 });
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (role !== undefined) updates.role = role;
    if (permissions !== undefined) updates.permissions = permissions;
    if (is_active !== undefined) updates.is_active = is_active;

    const { error } = await supabaseAdmin
      .from('hq_users')
      .update(updates)
      .eq('id', user_id);

    if (error) {
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
