import { NextResponse } from 'next/server';
import { POST as sync } from '../../admin/sync-invoices/route';
export const maxDuration = 60;
export async function GET() {
  console.log('⏰ Cron triggered: sync-invoices');
  try {
    const res = await sync(new Request('http://localhost'));
    const data = await res.json();
    return NextResponse.json({ triggered: 'invoices', ...data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
  }
}
