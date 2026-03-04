import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession, verifyPassword, hashPassword } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const result = await getSession();
    if (!result) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { current_password, new_password } = await request.json();

    if (!current_password || !new_password) {
      return NextResponse.json({ error: 'Both current and new passwords are required' }, { status: 400 });
    }

    if (new_password.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }

    // Get full user record with password hash
    const { data: user } = await supabaseAdmin
      .from('hq_users')
      .select('id, password_hash')
      .eq('id', result.user.id)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const valid = await verifyPassword(current_password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    // Hash and save new password
    const newHash = await hashPassword(new_password);
    await supabaseAdmin
      .from('hq_users')
      .update({ password_hash: newHash, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
