import { NextResponse } from 'next/server';
import { POST as sync } from '../../admin/sync-purchase-orders-recent/route';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET() {
  console.log('⏰ Cron triggered: sync-purchase-orders-recent');
  try {
    const res = await sync(new Request('http://localhost'));
    const data = await res.json();
    return NextResponse.json({ triggered: 'purchase-orders-recent', ...data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 }
    );
  }
}
