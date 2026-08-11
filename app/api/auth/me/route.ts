import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const result = await getSession();
    if (!result) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const u = result.user;
    return NextResponse.json({
      user: {
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        permissions: u.permissions ?? null,
      },
    });
  } catch (error) {
    console.error('Me error:', error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
