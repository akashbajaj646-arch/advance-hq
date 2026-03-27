import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    success: false,
    error: 'Sync All requires Vercel Pro for extended timeout. Data syncs automatically every night at 2am UTC via cron. Use individual sync buttons for manual on-demand syncs.',
    upgrade_required: true
  }, { status: 503 });
}
