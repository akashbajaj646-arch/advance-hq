import { NextResponse } from 'next/server';
import { POST as sync } from '../../admin/sync-shipments/route';
export const maxDuration = 60;
export async function GET() {
  console.log('⏰ Cron triggered: sync-shipments');
  try {
    const res = await sync(new Request('http://localhost'));
    const data = await res.json();
    return NextResponse.json({ triggered: 'shipments', ...data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
