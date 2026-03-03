import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('ahq_session')?.value;

    if (token) {
      await supabaseAdmin.from('app_sessions').delete().eq('token', token);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(clearSessionCookie());
    return response;
  } catch (error) {
    console.error('Logout error:', error);
    const response = NextResponse.json({ success: true });
    response.cookies.set(clearSessionCookie());
    return response;
  }
}
