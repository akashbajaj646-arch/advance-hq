import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword } from '@/lib/auth';

// One-time admin bootstrap: POST /api/auth/bootstrap
// Only works if no admin users exist yet
export async function POST(request: Request) {
  try {
    const { email, password, full_name } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Check if any admin already exists
    const { data: existingAdmins } = await supabaseAdmin
      .from('hq_users')
      .select('id')
      .eq('role', 'admin')
      .limit(1);

    if (existingAdmins && existingAdmins.length > 0) {
      return NextResponse.json({ error: 'Admin account already exists. Use the login page.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    const { data: user, error } = await supabaseAdmin
      .from('hq_users')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        full_name: full_name || 'Admin',
        role: 'admin',
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Bootstrap error:', error);
      return NextResponse.json({ error: 'Failed to create admin' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Admin account created. Please log in.',
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
