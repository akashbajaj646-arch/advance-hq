import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const { token, full_name, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Look up invite
    const { data: invite } = await supabaseAdmin
      .from('hq_invites')
      .select('*')
      .eq('token', token)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!invite) {
      return NextResponse.json({ error: 'Invalid or expired invite' }, { status: 400 });
    }

    // Check if user already exists
    const { data: existing } = await supabaseAdmin
      .from('hq_users')
      .select('id')
      .eq('email', invite.email)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'Account already exists. Please log in.' }, { status: 400 });
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const { data: user, error } = await supabaseAdmin
      .from('hq_users')
      .insert({
        email: invite.email,
        password_hash: passwordHash,
        full_name: full_name || invite.email.split('@')[0],
        role: invite.role,
        invited_by: invite.invited_by,
        invited_at: invite.created_at,
      })
      .select()
      .single();

    if (error || !user) {
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    // Mark invite as accepted
    await supabaseAdmin
      .from('hq_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    // Create session
    const sessionToken = await createSession(user.id);

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    });

    response.cookies.set(setSessionCookie(sessionToken));
    return response;
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
