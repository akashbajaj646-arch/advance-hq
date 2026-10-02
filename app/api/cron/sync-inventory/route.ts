import { NextResponse } from 'next/server';
import { POST as sync } from '../../admin/sync-inventory/route';

// Vercel cron (GET, no session cookie; /api/cron/ is a public path).
// maxDuration must match the admin route's budget or the cron dies at 60s.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET() {
  console.log('Cron triggered: sync-inventory');
  try {
    const res = await sync(new Request('http://localhost'));
    const data = await res.json();
    return NextResponse.json({ triggered: 'inventory', ...data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
