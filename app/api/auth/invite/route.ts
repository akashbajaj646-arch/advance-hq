import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const result = await getSession();
    if (!result || result.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { email, role = 'viewer' } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Check if user already exists
    const { data: existing } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 });
    }

    // Check if invite already pending
    const { data: existingInvite } = await supabaseAdmin
      .from('app_invites')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existingInvite) {
      return NextResponse.json({ error: 'Invite already pending for this email' }, { status: 400 });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

    const { data: invite, error } = await supabaseAdmin
      .from('app_invites')
      .insert({
        email: email.toLowerCase().trim(),
        token,
        invited_by: result.user.id,
        role,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003';
    const inviteLink = `${appUrl}/signup?token=${token}`;

    return NextResponse.json({
      success: true,
      invite: { id: invite.id, email: invite.email, role, expires_at: invite.expires_at },
      invite_link: inviteLink,
    });
  } catch (error) {
    console.error('Invite error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET: list pending invites (admin only)
export async function GET() {
  try {
    const result = await getSession();
    if (!result || result.user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { data: invites } = await supabaseAdmin
      .from('app_invites')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    return NextResponse.json({ invites: invites || [] });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
